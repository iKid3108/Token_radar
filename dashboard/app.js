// Token Radar's dashboard: a ranked board, per-row arithmetic and a farm plan, with filters and a
// detail view for every protocol. It reads window.RADAR (written beside dashboard/ by main.ts) and
// never reaches the network: every figure it shows is already in the data.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  if (!app) return;

  var MODEL = D.model;
  var state = { q: '', category: 'all', origin: 'all', tab: 'pre', sort: 'rank', dir: 1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined) return 'n/a';
    return Number(n).toFixed(2) + 'x';
  }
  function tone(n) {
    if (n === null || n === undefined) return 'dim';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- filters, sorting and the URL hash (so a view can be linked to and screenshotted) ----
  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('origin')) state.origin = p.get('origin');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) < 0 ? -1 : 1;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.selected) p.set('p', state.selected);
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.origin !== 'all') p.set('origin', state.origin);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir < 0) p.set('dir', '-1');
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname);
  }

  function matches(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function boardRows() {
    var list = D.rows.filter(function (r) {
      return (state.origin === 'all' || r.origin === state.origin) && matches(r);
    });
    var key = state.sort;
    return list.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return D.live.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  // ---- shared chrome ----
  function topBar() {
    return el('div', { class: 'bar-top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', null, 'TOKEN RADAR')
      ),
      el('div', { class: 'meta' },
        el('span', null, 'snapshot ' + D.as_of),
        el('span', null, el('b', null, String(D.watchlist_size)), ' watchlist / ', el('b', null, String(D.board_size)), ' ranked'),
        el('span', null, D.model_version)
      )
    );
  }
  function foot() {
    return el('div', { class: 'foot' },
      el('span', null, 'DefiLlama protocol snapshot ' + D.as_of + ' · ' + D.board_size + ' ranked rows · ' + D.live_size + ' live-token comparables'),
      el('span', null, 'Implied value is this radar’s estimate, not a promise of a token or a price.')
    );
  }
  function chip(text, kind) { return el('span', { class: 'chip ' + (kind || '') }, text); }
  function originChip(r) {
    var label = r.origin === 'watchlist' ? 'watchlist' : r.origin === 'below-floor' ? 'early find' : 'off-list';
    return chip(label, r.origin === 'watchlist' ? 'wl' : r.origin === 'below-floor' ? 'early' : 'off');
  }
  function valueCell(value, cap, isLive) {
    var width = Math.max(3, Math.round((value / cap) * 100));
    return el('div', { class: 'val' },
      el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { class: isLive ? 'live' : '', style: 'width:' + width + '%' })),
      el('b', null, fmtUsd(value))
    );
  }
  function segmented(options, value, onPick) {
    return el('div', { class: 'seg' }, options.map(function (o) {
      return el('button', {
        type: 'button',
        'aria-pressed': value === o.value ? 'true' : 'false',
        text: o.label,
        onclick: function () { onPick(o.value); }
      });
    }));
  }
  function stat(value, label) {
    return el('div', { class: 'stat' }, el('div', { class: 'v' }, String(value)), el('div', { class: 'k' }, label));
  }

  // ---- the board ----
  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('div', { class: 'kicker' }, 'PRE-TOKEN LAUNCH RADAR'),
        el('h1', null, 'Which protocol is worth farming before a token exists?'),
        el('p', { class: 'lede' },
          'Every protocol whose DefiLlama record carries no token, ranked by what a launch would be worth: the ',
          el('b', null, String(D.watchlist_size)),
          ' on the snapshot’s watchlist, ',
          el('b', null, String(D.early_size)),
          ' qualifying early protocols below the watchlist floor, and ',
          el('b', null, String(D.off_list_size)),
          ' at or above the floor that the list leaves out. Each row’s multiple is measured from the snapshot’s own ',
          el('b', null, String(D.live_size)),
          ' live-token protocols, tilted by seven-day TVL growth and by how long the protocol has run with no token. A record that carries no token is not proof there is none.'
        )
      ),
      el('div', { class: 'stats' },
        stat(D.watchlist_size, 'watchlist protocols covered'),
        stat(D.board_size, 'pre-token protocols ranked'),
        stat(D.early_size, 'early finds below the floor'),
        stat(D.off_list_size, 'at or above the floor, off-list'),
        stat(D.live_size, 'live tokens set aside'),
        stat(D.token_recorded_size, 'records that carry a token')
      )
    );
  }

  function controls() {
    var categories = Object.keys(D.rows.reduce(function (a, r) { a[r.category || 'Other'] = 1; return a; }, {})).sort();
    if (categories.indexOf(state.category) < 0 && state.category !== 'all') state.category = 'all';

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, slug, chain or category', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c }); })
    );
    select.value = state.category;
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });

    var shown = state.tab === 'live' ? liveRows().length : boardRows().length;
    return el('div', { class: 'controls' },
      segmented([
        { value: 'all', label: 'Whole board' },
        { value: 'watchlist', label: 'Watchlist' },
        { value: 'below-floor', label: 'Early finds' },
        { value: 'off-list', label: 'Off-list' }
      ], state.origin, function (v) { state.origin = v; writeHash(); render(); }),
      el('div', { class: 'search' }, search),
      select,
      segmented([
        { value: 'pre', label: 'No token recorded' },
        { value: 'live', label: 'Token already trades' }
      ], state.tab, function (v) { state.tab = v; writeHash(); render(); }),
      el('span', { class: 'count' }, el('b', null, String(shown)), ' rows shown')
    );
  }

  function th(label, key, align) {
    return el('th', { scope: 'col', class: align || null },
      el('button', {
        type: 'button',
        'data-on': state.sort === key ? 'true' : 'false',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        }
      },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true' }, state.dir < 0 ? '↓' : '↑') : null
      )
    );
  }

  function openDetail(slug) { state.selected = slug; writeHash(); render(); window.scrollTo(0, 0); }
  function rowAttrs(r) {
    return {
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    };
  }

  function boardTable() {
    var list = boardRows();
    if (!list.length) return emptyState();
    var cap = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', rowAttrs(r),
        el('td', { class: 'rank' }, el('b', null, '#' + r.rank)),
        el('td', null, el('div', { class: 'who' },
          el('b', null, r.name),
          el('span', null, (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(' / ') || 'chain unnamed'))
        )),
        el('td', { class: 'r' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'r ' + tone(r.change_7d) }, fmtPct(r.change_7d)),
        el('td', { class: 'r' }, fmtAge(r.age_days)),
        el('td', { class: 'r' }, fmtMult(r.model.multiple)),
        el('td', null, valueCell(r.implied_value_usd, cap, false)),
        el('td', null, originChip(r))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' }, 'Strongest implied launch value first. Select any row to audit its arithmetic, its comparables and its farm plan.'),
          el('thead', null, el('tr', null,
            th('#', 'rank'), th('Protocol', 'name'), th('TVL', 'tvl'), th('7d growth', 'growth'),
            th('Age', 'age'), th('Multiple', 'implied'), th('Implied value', 'implied'),
            el('th', { scope: 'col', text: 'Origin' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = liveRows();
    if (!list.length) return emptyState();
    var cap = Math.max.apply(null, list.map(function (r) { return r.mcap_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank' }, el('b', null, '#' + (i + 1))),
        el('td', null, el('div', { class: 'who' },
          el('b', null, r.name),
          el('span', null, (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(' / ') || 'chain unnamed'))
        )),
        el('td', { class: 'r' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'r ' + tone(r.change_7d) }, fmtPct(r.change_7d)),
        el('td', { class: 'r' }, fmtMult(r.multiple)),
        el('td', null, valueCell(r.mcap_usd, cap, true)),
        el('td', null, chip('already trades', 'live'))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' }, 'These protocols already trade, so their market cap is the market’s own number: shown beside the pre-token ranking, never folded into it.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d growth' }),
            el('th', { scope: 'col', text: 'Cap/TVL' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function emptyState() {
    return el('div', { class: 'panel' },
      el('div', { class: 'empty' },
        el('h2', null, 'No protocol matches that filter'),
        el('p', null, 'Clear the search or choose another category to see the ranking again.'),
        el('button', {
          class: 'button primary', type: 'button', text: 'Clear filters',
          onclick: function () { state.q = ''; state.category = 'all'; state.origin = 'all'; writeHash(); render(); }
        })
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    var formula = 'multiple = category median(mcap / TVL) of live protocols, shrunk toward ' + fmtMult(D.prior_multiple) +
      '\n           by ' + m.prior_weight + ' prior rows, clipped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']' +
      '\ngrowth   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight +
      '\nmaturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range +
      '\nimplied  = round( tvl_usd × multiple × growth × maturity )';
    return el('section', { class: 'notes' },
      el('div', { class: 'card' },
        el('h3', null, 'The value model'),
        el('div', { class: 'formula' }, formula),
        el('p', { class: 'sub' },
          'One function scores every row and no protocol name is special-cased. The multiple is measured from the ',
          String(D.live_size),
          ' live-token protocols in the snapshot, so the same data supplies both the comparables and the ranking. The seven-day change is clipped at ',
          String(m.growth_floor) + '% and +' + String(m.growth_cap) + '%',
          ' so one wild week cannot dominate. Age is the time since DefiLlama began tracking the protocol; an unknown age uses ',
          String(m.unknown_age_days) + ' days.'
        )
      ),
      el('div', { class: 'card' },
        el('h3', null, 'Category multiples'),
        el('p', { class: 'sub' }, 'Live peers, the median cap/TVL and the shrunk multiple this board uses:'),
        el('div', { class: 'catrows' }, D.categories.slice(0, 18).map(function (c) {
          return el('div', { class: 'catrow' },
            el('span', { class: 'c', text: c.category }),
            el('span', { class: 'n', text: c.peers + ' peers' }),
            el('span', { class: 'm', text: fmtMult(c.used_multiple) })
          );
        })),
        el('p', { class: 'sub' }, String(D.categories.length) + ' categories in all; each detail view names its own peers.')
      )
    );
  }

  // ---- the detail view ----
  function detailFor(r) {
    var live = r.token_status !== 'pre-token';
    var m = r.model || {};
    var calc = Math.max(1, Math.round(r.tvl_usd * m.multiple * m.growth_multiplier * m.maturity_multiplier));
    var steps = r.farm_steps || [];
    var peers = r.comparables || [];

    var left = el('div', { class: 'dcol' },
      el('section', { class: 'card' },
        el('h2', null, live ? 'What the market says' : 'What the model says'),
        el('p', { class: 'sub' }, live
          ? 'This protocol already trades. Its market cap is a market fact, not a model output, so it stays outside the pre-token ranking.'
          : 'The same arithmetic every row gets: TVL times a category multiple, a growth tilt and a maturity tilt.'),
        el('div', { class: 'kv' },
          el('div', null, el('div', { class: 'k' }, 'TVL'), el('div', { class: 'v' }, fmtUsd(r.tvl_usd))),
          el('div', null, el('div', { class: 'k' }, 'Seven-day TVL'), el('div', { class: 'v ' + tone(r.change_7d) }, fmtPct(r.change_7d))),
          el('div', null, el('div', { class: 'k' }, 'Age on record'), el('div', { class: 'v' }, fmtAge(r.age_days))),
          el('div', null, el('div', { class: 'k' }, 'Listed'), el('div', { class: 'v' }, r.listed_at || 'unknown'))
        ),
        live ? null : el('div', { class: 'eq' },
          el('div', { class: 'l' }, 'TVL'), el('div', { class: 'r' }, fmtUsd(r.tvl_usd)),
          el('div', { class: 'l' }, 'Category multiple (' + (m.category_peers || 0) + ' live peers)'), el('div', { class: 'r' }, fmtMult(m.multiple)),
          el('div', { class: 'l' }, 'Growth multiplier (' + fmtPct(m.growth_pct) + ' clipped)'), el('div', { class: 'r' }, fmtMult(m.growth_multiplier)),
          el('div', { class: 'l' }, 'Maturity multiplier (' + fmtAge(r.age_days) + ' on record)'), el('div', { class: 'r' }, fmtMult(m.maturity_multiplier)),
          el('div', { class: 'l total' }, 'Implied value'), el('div', { class: 'r total' }, fmtUsd(r.implied_value_usd))
        ),
        live ? null : el('p', { class: 'sub' },
          'Recomputed from the displayed factors: ' + fmtUsd(calc) + (calc === r.implied_value_usd ? ', the number board.json carries. ' : ', which differs from the board’s ' + fmtUsd(r.implied_value_usd) + '. ') +
          'The multiple uses ' + (m.category_peers || 0) + ' live ' + (r.category || 'category') + ' comparable' + (m.category_peers === 1 ? '' : 's') +
          ', median ' + fmtMult(m.category_median) + ', shrunk toward the global ' + fmtMult(D.prior_multiple) + '.')
      ),
      el('section', { class: 'card' },
        el('h3', null, 'Category comparables'),
        el('table', { class: 'peers' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Live protocol' }), el('th', { scope: 'col', class: 'r', text: 'TVL' }),
            el('th', { scope: 'col', class: 'r', text: 'Market cap' }), el('th', { scope: 'col', class: 'r', text: 'Multiple' })
          )),
          el('tbody', null, peers.map(function (p) {
            return el('tr', null,
              el('td', null, p.name),
              el('td', { class: 'r' }, fmtUsd(p.tvl_usd)),
              el('td', { class: 'r' }, fmtUsd(p.mcap_usd)),
              el('td', { class: 'r' }, fmtMult(p.multiple))
            );
          }))
        ),
        peers.length ? null : el('p', { class: 'sub' }, 'No live protocol in this category: the global median is used instead.')
      )
    );

    var right = el('div', { class: 'dcol' },
      el('section', { class: 'card' },
        el('h3', null, 'How to farm it'),
        el('p', { class: 'sub' }, steps.length + ' concrete steps, each with its cost and its time. Derived from the protocol’s own category, chains, TVL and age, never from a hand-written name list.'),
        el('ol', { class: 'steps' }, steps.map(function (s, i) {
          var cut = / Cost: (.*?)\. Time: (.*?)\.$/.exec(s);
          return el('li', null,
            el('span', { class: 'no' }, String(i + 1).padStart(2, '0')),
            el('div', null,
              el('p', null, cut ? s.slice(0, cut.index) : s),
              el('span', { class: 'ct' }, cut ? 'Cost: ' + cut[1] + '  ·  Time: ' + cut[2] : 'See the protocol’s own page for current costs.')
            )
          );
        }))
      ),
      el('section', { class: 'card' },
        el('h3', null, 'Read the record'),
        el('p', { class: 'sub' },
          'Records no token: market cap ' + (r.mcap_usd === null ? 'is not recorded' : fmtUsd(r.mcap_usd)) +
          ', CoinGecko id ' + (r.gecko_id === null ? 'absent' : 'present') +
          ', symbol ' + (r.symbol === null ? 'absent' : 'present') +
          '. That is what the snapshot says, not proof that no token exists. Chains: ' + ((r.chains || []).join(', ') || 'not recorded') + '.'),
        el('p', { class: 'sub' }, r.origin === 'watchlist'
          ? 'Origin: on the snapshot watchlist — at or above the $' + Math.round(D.floor_usd / 1e6) + 'M floor with no token recorded.'
          : r.origin === 'below-floor'
            ? 'Origin: an early find below the watchlist floor — the radar’s discovery lane.'
            : 'Origin: a pre-token protocol at or above the floor that the watchlist leaves out.')
      )
    );

    var index = D.rows.findIndex(function (x) { return x.slug === r.slug; });
    var prev = index > 0 ? D.rows[index - 1] : null;
    var next = index >= 0 && index < D.rows.length - 1 ? D.rows[index + 1] : null;
    var jump = el('div', { class: 'jump' },
      prev ? el('a', { href: '#p=' + encodeURIComponent(prev.slug), onclick: function (e) { e.preventDefault(); openDetail(prev.slug); } },
        el('span', null, '← Rank ' + prev.rank), el('b', null, prev.name)) : el('span'),
      next ? el('a', { class: 'next', href: '#p=' + encodeURIComponent(next.slug), onclick: function (e) { e.preventDefault(); openDetail(next.slug); } },
        el('span', null, 'Rank ' + next.rank + ' →'), el('b', null, next.name)) : el('span')
    );

    return el('div', { class: 'shell' },
      topBar(),
      el('a', { class: 'back', href: '#', onclick: function (e) { e.preventDefault(); state.selected = null; writeHash(); render(); } }, '← Back to the board'),
      el('header', { class: 'dhead' },
        el('div', null,
          el('div', { class: 'eyebrow' },
            chip(live ? 'token already trades' : 'rank ' + r.rank + ' of ' + D.board_size, 'wl'),
            chip(r.category || 'Other'),
            originChip(r)
          ),
          el('h1', null, r.name),
          el('div', { class: 'where' }, (r.category || 'Other') + ' · ' + ((r.chains || []).join(' / ') || 'chain unnamed') + ' · DefiLlama record ' + (r.listed_at ? 'from ' + r.listed_at : 'with no listing date'))
        ),
        el('div', { class: 'big' },
          el('div', { class: 'v' }, fmtUsd(live ? r.mcap_usd : r.implied_value_usd)),
          el('div', { class: 'k' }, live ? 'market cap (observed)' : 'implied launch value (model)')
        )
      ),
      el('div', { class: 'dgrid' }, left, right),
      jump,
      foot()
    );
  }

  function boardView() {
    return el('div', { class: 'shell' }, topBar(), hero(), controls(),
      state.tab === 'pre' ? boardTable() : liveTable(),
      state.tab === 'pre' ? modelPanel() : null,
      foot()
    );
  }

  function render() {
    app.textContent = '';
    app.setAttribute('aria-busy', 'false');
    var row = state.selected ? D.rows.find(function (r) { return r.slug === state.selected; }) : null;
    if (state.selected && !row) {
      var live = D.live.find(function (r) { return r.slug === state.selected; });
      if (live) {
        row = {
          slug: live.slug, name: live.name, category: live.category, chains: live.chains,
          tvl_usd: live.tvl_usd, mcap_usd: live.mcap_usd, change_7d: live.change_7d,
          listed_at: null, gecko_id: null, symbol: null, origin: 'live', rank: 0,
          token_status: 'live', age_days: null, farm_steps: [], comparables: [], model: {}
        };
      }
    }
    app.appendChild(row ? detailFor(row) : boardView());
  }

  readHash();
  render();
  // A hand-edited hash is a fresh view: reset every filter, then read whatever the hash carries.
  window.addEventListener('hashchange', function () {
    state = { q: '', category: 'all', origin: 'all', tab: 'pre', sort: 'rank', dir: 1, selected: null };
    readHash();
    render();
  });
})();
