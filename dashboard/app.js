// Token Radar dashboard: offline and static, reads window.RADAR and window.BACKTEST from
// data.js beside the page. Sections: weights, DOM builder, hash, filters, tables, detail,
// validation, keyboard.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var V = window.BACKTEST || null;
  var app = document.getElementById('app');
  if (!app) return;
  var M = D.model;

  // The whole view is this one object: the URL hash mirrors it, so any view can be linked.
  var state = {
    panel: 'board',   // board | validation
    tab: 'pre',       // pre | live
    q: '',
    cat: 'all',
    origin: 'all',
    sort: 'rank',
    dir: 1,
    open: null,       // slug shown in the detail view
    exp: null         // slug whose components are expanded in the board
  };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function mult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return Number(n).toFixed(2) + 'x';
  }
  function age(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function tone(n) {
    if (n === null || n === undefined) return 'dim';
    return n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim';
  }

  // Each tilt is an exponent on its stored multiplier: 1 reproduces board.json, 0 disables it.

  var TILTS = [
    { key: 'flow', label: 'Flow tilt', hint: '7-day robust-flow growth multiplier' },
    { key: 'outlier', label: 'Stale week', hint: 'penalty for a flow past the winsor bound' },
    { key: 'velocity', label: 'Velocity', hint: 'bounded boost for outgrowing the category' },
    { key: 'concentration', label: 'Chain', hint: 'discount for a single-chain record' },
    { key: 'maturity', label: 'Maturity', hint: 'age tilt' }
  ];
  var ONE = { flow: 1, outlier: 1, velocity: 1, concentration: 1, maturity: 1 };
  var weights = { flow: 1, outlier: 1, velocity: 1, concentration: 1, maturity: 1 };
  var rankBySlug = null;   // slug -> rank, only while the weights differ from the board's
  var hosts = { table: null, count: null, status: null, reset: null };

  function num(n) { return n === null || n === undefined ? 1 : Number(n); }
  function score(row, w) {
    var m = row.model || {};
    var s = (m.base_value_usd || 0) *
      Math.pow(num(m.growth_multiplier), w.flow) *
      Math.pow(num(m.outlier_penalty), w.outlier) *
      Math.pow(num(m.velocity_multiplier), w.velocity) *
      Math.pow(num(m.concentration_multiplier), w.concentration) *
      Math.pow(num(m.maturity_multiplier), w.maturity);
    return Math.max(1, Math.round(s));
  }
  function atDefault() {
    for (var i = 0; i < TILTS.length; i++) {
      if (weights[TILTS[i].key] !== ONE[TILTS[i].key]) return false;
    }
    return true;
  }
  function shownValue(row) { return rankBySlug ? score(row, weights) : row.implied_value_usd; }
  function shownMult(row) { return row.tvl_usd > 0 ? shownValue(row) / row.tvl_usd : 0; }
  function shownRank(row) {
    return rankBySlug && rankBySlug[row.slug] ? rankBySlug[row.slug] : row.rank;
  }
  function rebuildRanks() {
    if (atDefault()) { rankBySlug = null; return; }
    var sorted = D.rows.slice().sort(function (a, b) {
      var d = score(b, weights) - score(a, weights);
      return d !== 0 ? d : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    var map = {};
    for (var i = 0; i < sorted.length; i++) map[sorted[i].slug] = i + 1;
    rankBySlug = map;
  }
  function move(row) {
    if (!rankBySlug) return null;
    var d = row.rank - shownRank(row);
    if (d === 0) return null;
    return el('span', { class: 'move ' + (d > 0 ? 'up' : 'down'), title: 'Board rank #' + row.rank },
      (d > 0 ? ' ↑' : ' ↓') + Math.abs(d));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        for (var j = 0; j < child.length; j++) if (child[j]) node.appendChild(child[j]);
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('p')) state.open = p.get('p');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.cat = p.get('category');
    if (p.get('origin')) state.origin = p.get('origin');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) < 0 ? -1 : 1;
    if (p.get('x')) state.exp = p.get('x');
    if (p.get('panel')) state.panel = p.get('panel');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.open) p.set('p', state.open);
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('category', state.cat);
    if (state.origin !== 'all') p.set('origin', state.origin);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir < 0) p.set('dir', '-1');
    if (state.exp) p.set('x', state.exp);
    if (state.panel !== 'board') p.set('panel', state.panel);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname);
  }

  function categories() {
    var seen = {};
    for (var i = 0; i < D.rows.length; i++) seen[D.rows[i].category || 'Other'] = 1;
    return Object.keys(seen).sort();
  }
  function hit(row) {
    if (state.cat !== 'all' && (row.category || 'Other') !== state.cat) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    return [row.name, row.slug, row.category || '', (row.chains || []).join(' ')]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function boardRows() {
    var out = [];
    for (var i = 0; i < D.rows.length; i++) {
      var r = D.rows[i];
      if ((state.origin === 'all' || r.origin === state.origin) && hit(r)) out.push(r);
    }
    var key = state.sort;
    out.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else if (key === 'implied') { av = shownValue(a); bv = shownValue(b); }
      else { av = shownRank(a); bv = shownRank(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return out;
  }
  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return D.live.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function chip(text, kind) {
    return el('span', { class: 'chip ' + (kind || '') }, text);
  }
  function originChip(row) {
    var kind = row.origin === 'watchlist' ? 'wl' : row.origin === 'below-floor' ? 'early' : 'off';
    var text = row.origin === 'watchlist' ? 'watchlist' : row.origin === 'below-floor' ? 'early find' : 'off-list';
    return chip(text, kind);
  }
  function valueCell(value, cap, live) {
    var width = Math.max(3, Math.round((value / (cap || 1)) * 100));
    return el('div', { class: 'val' },
      el('div', { class: 'track', 'aria-hidden': 'true' },
        el('i', { class: live ? 'live' : null, style: 'width:' + width + '%' })),
      el('b', null, usd(value)));
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
  function signed3(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(3);
  }

  function topBar() {
    function tab(label, key) {
      return el('button', {
        type: 'button',
        'aria-pressed': state.panel === key ? 'true' : 'false',
        text: label,
        onclick: function () { state.panel = key; writeHash(); render(); }
      });
    }
    return el('div', { class: 'bar-top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', null, 'TOKEN RADAR')),
      el('div', { class: 'seg tabs' }, tab('Board', 'board'), tab('Validation report', 'validation')),
      el('div', { class: 'meta' },
        el('span', null, 'snapshot ' + D.as_of),
        el('span', null, el('b', null, String(D.watchlist_size)), ' watchlist / ', el('b', null, String(D.board_size)), ' ranked'),
        el('span', null, D.model_version)));
  }
  function foot() {
    return el('div', { class: 'foot' },
      el('span', null, 'DefiLlama protocol snapshot ' + D.as_of + ' · ' + D.board_size + ' ranked rows · ' + D.live_size + ' live-token comparables'),
      el('span', null, 'Implied value is this radar’s estimate, not a promise of a token or a price.'));
  }

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
          ' at or above the floor that the list leaves out. Each base value is a log-log comparables regression over the snapshot’s ',
          el('b', null, String(D.live_size)),
          ' live-token protocols, fitted inside each category against its median TVL. A winsorized seven-day flow tilts that base, a robust median/MAD test damps any stale outlier week, faster-than-category growth earns a bounded velocity boost and a single-chain record takes a concentration discount. The weight sliders re-rank every row live from those stored terms. A record that carries no token is not proof there is none.')),
      el('div', { class: 'stats' },
        stat(D.watchlist_size, 'watchlist protocols covered'),
        stat(D.board_size, 'pre-token protocols ranked'),
        stat(D.early_size, 'early finds below the floor'),
        stat(D.off_list_size, 'at or above the floor, off-list'),
        stat(D.live_size, 'live tokens set aside'),
        stat(D.token_recorded_size, 'records that carry a token')));
  }

  function controls() {
    var cats = categories();
    if (state.cat !== 'all' && cats.indexOf(state.cat) < 0) state.cat = 'all';

    var search = el('input', {
      type: 'search', id: 'q', placeholder: 'Name, slug, chain or category',
      value: state.q, 'aria-label': 'Search the board'
    });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });

    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c }); }));
    select.value = state.cat;
    select.addEventListener('change', function () { state.cat = select.value; writeHash(); render(); });

    hosts.count = el('b', null, String(state.tab === 'live' ? liveRows().length : boardRows().length));
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
      el('span', { class: 'count' }, hosts.count, ' rows shown'));
  }

  /** The weight sliders: exponents on the stored tilts, re-ranking the table as they move. */
  function weightPanel() {
    hosts.status = el('span', { class: 'wstat' }, atDefault()
      ? 'every tilt at ×1.00: this is board.json’s own ranking'
      : 're-ranked in this page from the stored components');
    hosts.reset = el('button', {
      type: 'button', class: 'button', text: 'Reset weights',
      onclick: function () {
        for (var i = 0; i < TILTS.length; i++) weights[TILTS[i].key] = ONE[TILTS[i].key];
        rebuildRanks();
        render();
      }
    });
    hosts.reset.disabled = atDefault();

    return el('div', { class: 'weights' },
      el('span', { class: 'wtitle' }, 'Score weights'),
      TILTS.map(function (t) {
        var out = el('span', { class: 'wv' }, '×' + Number(weights[t.key]).toFixed(2));
        var input = el('input', {
          type: 'range', min: '0', max: '2', step: '0.25', value: String(weights[t.key]),
          'aria-label': t.label + ' weight', title: t.hint
        });
        input.addEventListener('input', function () {
          weights[t.key] = Number(input.value);
          out.textContent = '×' + Number(weights[t.key]).toFixed(2);
          rebuildRanks();
          paintBoard();
        });
        return el('label', null, el('span', { text: t.label }), input, out);
      }),
      hosts.status,
      el('span', { class: 'reset' }, hosts.reset));
  }

  /** Repaint just the table and the counters, so a slider drag never loses the slider itself. */
  function paintBoard() {
    if (hosts.table) {
      hosts.table.textContent = '';
      hosts.table.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    }
    if (hosts.count) hosts.count.textContent = String(state.tab === 'live' ? liveRows().length : boardRows().length);
    if (hosts.status) {
      hosts.status.textContent = atDefault()
        ? 'every tilt at ×1.00: this is board.json’s own ranking'
        : 're-ranked in this page from the stored components';
    }
    if (hosts.reset) hosts.reset.disabled = atDefault();
  }

  function toggleExpanded(slug) {
    state.exp = state.exp === slug ? null : slug;
    writeHash();
    paintBoard();
    var buttons = hosts.table ? hosts.table.querySelectorAll('button.exp') : [];
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-slug') === slug) { buttons[i].focus(); break; }
    }
  }

  /** A sortable column head: the second click flips the direction. */
  function th(label, key, align) {
    return el('th', { scope: 'col', class: align || null },
      el('button', {
        type: 'button',
        'data-on': state.sort === key ? 'true' : 'false',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash();
          render();
        }
      },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true' }, state.dir < 0 ? '↓' : '↑') : null));
  }

  function rowAttrs(r) {
    return {
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
      }
    };
  }

  /** Every line is a field board.json already carries; the product is recomputed and checked. */
  function breakdown(r) {
    var m = r.model || {};
    var grid = el('div', { class: 'calc' });
    function line(k, d, v, cls) {
      grid.appendChild(el('div', { class: 'k ' + (cls || '') }, k));
      grid.appendChild(el('div', { class: 'd ' + (cls || '') }, d));
      grid.appendChild(el('div', { class: 'v ' + (cls || '') }, v));
    }
    var stale = m.flow_stale === true;
    line('Regression base',
      'anchor ' + usd(m.category_anchor_tvl) + ' × ' + mult(m.category_multiple) + ' at that anchor × (TVL / anchor)^β — ' +
        (m.category_fallback ? 'no live peer in this category, so the global fit answered'
          : (m.category_peers || 0) + ' live comparable' + (m.category_peers === 1 ? '' : 's')),
      usd(m.base_value_usd));
    line('Category anchor',
      'the median TVL of every ' + (r.category || 'Other') + ' record the snapshot lists, live or not',
      mult(m.category_multiple));
    line('Flow tilt',
      pct(m.flow_center) + ' ± ' + pct(m.flow_scale) + ' robust ' + (m.flow_fallback ? 'global' : (r.category || 'category')) +
        ' baseline; this week ' + pct(r.change_7d) + ' → winsorized ' + pct(m.flow_used_pct) +
        ' (z ' + (m.flow_z === null || m.flow_z === undefined ? 'n/a' : Number(m.flow_z).toFixed(2)) + ')',
      mult(m.growth_multiplier));
    line('Stale-week penalty',
      stale ? 'beyond ±' + M.flow_winsor + ' robust sigmas, so the growth input is damped'
        : 'inside ±' + M.flow_winsor + ' robust sigmas: no damping',
      mult(m.outlier_penalty));
    line('Launch velocity',
      stale ? 'a damped stale week earns no velocity credit on top'
        : Number(m.velocity_boost_pct || 0) > 0
          ? '+' + Number(m.velocity_boost_pct).toFixed(0) + '% faster than its category’s flow centre (z ' +
            Number(m.velocity_z || 0).toFixed(2) + ', capped at ' + M.velocity_cap + ')'
          : 'at or below its category’s flow centre: no boost, and never a penalty',
      mult(m.velocity_multiplier));
    line('Chain concentration',
      (m.chain_count || 0) + ' chain' + (m.chain_count === 1 ? '' : 's') + ' on record' +
        (m.concentration_single ? ' — a single-chain record, so the value is discounted' : ''),
      mult(m.concentration_multiplier));
    line('Maturity tilt',
      age(r.age_days) + ' on record; an unknown age counts as ' + M.unknown_age_days + ' days',
      mult(m.maturity_multiplier));
    if (!atDefault()) {
      line('Weights in this page',
        TILTS.map(function (t) { return t.label + ' ' + Number(weights[t.key]).toFixed(2); }).join(', '), '');
    }
    line('Final score',
      'base × flow^w × stale^w × velocity^w × chain^w × maturity^w',
      usd(shownValue(r)), 'tot');
    if (!atDefault()) {
      line('Board’s own score', 'board.json rank #' + r.rank + ' with every tilt at 1.00', usd(r.implied_value_usd), 'tot');
    }
    var recomputed = score(r, atDefault() ? ONE : weights);
    var stored = r.implied_value_usd;
    return el('div', { class: 'bd' },
      el('p', { class: 'sub' },
        'Every term below is stored in board.json for this row; the page computes nothing it was not given. ' +
        'The product of the displayed terms comes to ' + usd(recomputed) +
        (atDefault()
          ? (recomputed === stored
              ? ', the implied value board.json stores for this row.'
              : ', against the ' + usd(stored) + ' board.json stores for it.')
          : ', the re-ranked value at the weights above; board.json stores ' + usd(stored) + ' for it.')),
      grid);
  }

  function boardTable() {
    var list = boardRows();
    if (list.length === 0) return emptyState();
    var cap = 1;
    for (var i = 0; i < list.length; i++) cap = Math.max(cap, shownValue(list[i]));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var open = state.exp === r.slug;
      tbody.appendChild(el('tr', rowAttrs(r),
        el('td', { class: 'rank' },
          el('button', {
            type: 'button', class: 'exp', 'data-slug': r.slug,
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': (open ? 'Hide' : 'Show') + ' the score components for ' + r.name,
            title: 'Show every component of this score',
            onclick: function (e) { e.stopPropagation(); toggleExpanded(r.slug); },
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }
          }, open ? '▾' : '▸'),
          el('b', null, '#' + shownRank(r)),
          move(r)),
        el('td', null, el('div', { class: 'who' },
          el('b', null, r.name),
          el('span', null, (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(' / ') || 'no chain recorded')))),
        el('td', { class: 'r' }, usd(r.tvl_usd)),
        el('td', { class: 'r ' + tone(r.change_7d) }, pct(r.change_7d),
          r.model && r.model.flow_stale
            ? el('span', {
                class: 'stale',
                title: 'Stale flow: winsorized at ±' + M.flow_winsor + ' robust sigmas; the result is damped by ' +
                  mult(r.model.outlier_penalty) + '.'
              }, ' ⚠')
            : null),
        el('td', { class: 'r' }, age(r.age_days)),
        el('td', {
          class: 'r',
          title: 'base ' + mult(r.model.base_multiple) + ' → flow ' + mult(r.model.growth_multiplier) +
            ', stale ' + mult(r.model.outlier_penalty) + ', velocity ' + mult(r.model.velocity_multiplier) +
            ', chain ' + mult(r.model.concentration_multiplier) + ', maturity ' + mult(r.model.maturity_multiplier)
        }, mult(shownMult(r))),
        el('td', null, valueCell(shownValue(r), cap, false)),
        el('td', null, originChip(r))));
      if (open) {
        tbody.appendChild(el('tr', { class: 'bdrow' },
          el('td', { colspan: '8' }, breakdown(r))));
      }
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' },
            'Strongest implied value first. Expand a row (▸) for every component of its score, or select the row for its ' +
            'comparables, its arithmetic and its farm plan.'),
          el('thead', null, el('tr', null,
            th('#', 'rank'), th('Protocol', 'name'), th('TVL', 'tvl'), th('7d growth', 'growth'),
            th('Age', 'age'), th('Multiple', 'implied'), th('Implied value', 'implied'),
            el('th', { scope: 'col', text: 'Origin' }))),
          tbody)));
  }

  function liveTable() {
    var list = liveRows();
    if (list.length === 0) return emptyState();
    var cap = 1;
    for (var i = 0; i < list.length; i++) cap = Math.max(cap, list[i].mcap_usd || 0);
    var tbody = el('tbody');
    list.forEach(function (r, i) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank' }, el('b', null, '#' + (i + 1))),
        el('td', null, el('div', { class: 'who' },
          el('b', null, r.name),
          el('span', null, (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(' / ') || 'no chain recorded')))),
        el('td', { class: 'r' }, usd(r.tvl_usd)),
        el('td', { class: 'r ' + tone(r.change_7d) }, pct(r.change_7d)),
        el('td', { class: 'r' }, mult(r.multiple)),
        el('td', null, valueCell(r.mcap_usd, cap, true)),
        el('td', null, chip('already trades', 'live'))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' },
            'These protocols already trade, so their market cap is the market’s own number: kept beside the pre-token ' +
            'ranking, never folded into it, and never compared on the model’s implied value.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d growth' }),
            el('th', { scope: 'col', text: 'Cap/TVL' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  function emptyState() {
    return el('div', { class: 'panel' },
      el('div', { class: 'empty' },
        el('h2', null, 'No protocol matches that filter'),
        el('p', null, 'Clear the search or pick another category to see the ranking again.'),
        el('button', {
          class: 'button primary', type: 'button', text: 'Clear filters',
          onclick: function () {
            state.q = ''; state.cat = 'all'; state.origin = 'all';
            writeHash(); render();
          }
        })));
  }

  /** The model's own constants, stated on the page as the judge reads it. */
  function modelNotes() {
    var r = D.regression;
    var formula = [
      'base     = anchor × multiple × (TVL / anchor)^β    β = ' + r.beta + ' from ' + r.pairs + ' peer pairs',
      'β        = median within-category Theil–Sen slope; pairs under ' + M.beta_min_ratio + '× TVL apart skipped, clamped to [' + M.beta_floor + ', ' + M.beta_cap + ']',
      'anchor   = the category’s median TVL over every record the snapshot lists there',
      'multiple = median log(cap/TVL) at the anchor, shrunk toward the equal-category median by ' + M.multiple_prior_weight + ' prior peers',
      'flow     = median ± max(' + M.flow_scale_floor + '%, 1.4826 × MAD); the snapshot-wide pool when a category has fewer than ' + M.flow_min_peers + ' readings',
      'growth   = 1 + clamp(winsorized flow, ' + M.growth_floor + ', +' + M.growth_cap + ') / 100 × ' + M.growth_weight,
      'outlier  = clamp(1 − ' + M.flow_penalty_step + ' × max(0, |z| − ' + M.flow_winsor + '), ' + M.flow_penalty_floor + ', ' + M.flow_penalty_cap + ')',
      'velocity = 1 + min(max(z, 0), ' + M.velocity_cap + ') × ' + M.velocity_weight + '    above the category centre only, never a penalty',
      'chain    = ' + M.concentration_single_mult + ' for a single-chain record, else 1',
      'maturity = ' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' × ' + M.maturity_range + '    unknown age counts as ' + M.unknown_age_days + ' days',
      'implied  = max(1, round(base × growth × outlier × velocity × chain × maturity))'
    ].join('\n');
    var top = D.categories.slice(0, 18);
    return el('section', { class: 'notes' },
      el('div', { class: 'card' },
        el('h3', null, 'The value model'),
        el('div', { class: 'formula' }, formula),
        el('p', { class: 'sub' },
          'One function scores every row and no protocol is named in it. The regression is fitted to the ' + D.live_size +
          ' live-token protocols the snapshot carries, inside each category, so a category’s own median TVL is the anchor ' +
          'rather than one peer’s market cap. The global fallback fit puts cap/TVL at ' + mult(r.multiple_at_anchor) +
          ' at the ' + usd(r.anchor_tvl_usd) + ' snapshot-wide anchor (log multiple ' + r.log_multiple_at_anchor + '). ' +
          'The seven-day flow is winsorized at ' + M.flow_winsor + ' robust sigmas — median ± 1.4826 × MAD — and clipped to ' +
          M.growth_floor + '%..+' + M.growth_cap + '%, so a single stale week cannot carry a rank. Growth above the ' +
          'category’s own robust centre earns a bounded velocity boost of at most ×' + (1 + M.velocity_cap * M.velocity_weight).toFixed(2) +
          ', a single-chain record takes the ×' + M.concentration_single_mult + ' concentration discount, and age is the time ' +
          'since DefiLlama began tracking the protocol. Every multiplier is stored on the row, so the weight sliders above ' +
          'the board re-rank the whole table offline from the same figures.')),
      el('div', { class: 'card' },
        el('h3', null, 'Category fits'),
        el('p', { class: 'sub' }, 'Live peers, the category’s median-TVL anchor and the cap/TVL the fit implies there:'),
        el('div', { class: 'catrows' },
          el('div', { class: 'catrow cathead', 'aria-hidden': 'true' },
            el('span', { class: 'c', text: 'Category' }),
            el('span', { class: 'n', text: 'Peers' }),
            el('span', { class: 'a', text: 'TVL anchor' }),
            el('span', { class: 'm', text: 'Fit cap/TVL' })),
          top.map(function (c) {
            return el('div', { class: 'catrow' },
              el('span', { class: 'c', title: c.category, text: c.category }),
              el('span', { class: 'n', text: String(c.peers) }),
              el('span', { class: 'a', text: usd(c.anchor_tvl_usd) }),
              el('span', { class: 'm', text: mult(c.multiple_at_anchor) }));
          })),
        el('p', { class: 'sub' }, D.categories.length + ' categories in all; the strongest ' + top.length +
          ' by ranked rows are shown, and every detail view names its own peers and fitted terms.')));
  }

  function openDetail(slug) {
    state.open = slug;
    writeHash();
    render();
    window.scrollTo(0, 0);
  }

  function kv(k, v, cls) {
    return el('div', null, el('div', { class: 'k' }, k), el('div', { class: 'v ' + (cls || '') }, v));
  }

  /** One row of the equation table: a label on the left, its value on the right. */
  function eqRow(label, value, cls) {
    return [el('div', { class: 'l ' + (cls || '') }, label), el('div', { class: 'r ' + (cls || '') }, value)];
  }

  function originSentence(r) {
    if (r.origin === 'watchlist') {
      return 'Origin: on the snapshot watchlist — at or above the $' + Math.round(D.floor_usd / 1e6) +
        'M floor with no token recorded.';
    }
    if (r.origin === 'below-floor') return 'Origin: an early find below the watchlist floor — the discovery lane.';
    return 'Origin: a pre-token protocol at or above the floor that the watchlist leaves out.';
  }

  /** One farm step: the action, then the cost and time the plan states for it. */
  function stepItem(step, i) {
    var cut = / Cost: (.*?)\. Time: (.*?)\.$/.exec(step);
    return el('li', null,
      el('span', { class: 'no' }, String(i + 1).padStart(2, '0')),
      el('div', null,
        el('p', null, cut ? step.slice(0, cut.index) : step),
        el('span', { class: 'ct' }, cut ? 'Cost: ' + cut[1] + ' · Time: ' + cut[2] : 'See the protocol’s own page.')));
  }

  function detailView(r) {
    var m = r.model || {};
    var steps = r.farm_steps || [];
    var peers = r.comparables || [];
    var computed = score(r, atDefault() ? ONE : weights);
    var idx = r.rank > 0 ? r.rank - 1 : -1;
    var prev = idx > 0 ? D.rows[idx - 1] : null;
    var next = idx >= 0 && idx < D.rows.length - 1 ? D.rows[idx + 1] : null;
    var flowSource = m.flow_fallback ? 'snapshot-wide' : (r.category || 'category');

    var left = el('div', { class: 'dcol' },
      el('section', { class: 'card' },
        el('h3', null, 'Why this score'),
        el('div', { class: 'kv' },
          kv('TVL', usd(r.tvl_usd)),
          kv('7-day TVL', pct(r.change_7d), tone(r.change_7d)),
          kv('Age on record', age(r.age_days)),
          kv('First tracked', r.listed_at || 'unknown')),
        el('div', { class: 'eq' },
          eqRow('TVL anchor (' + (m.category_peers || 0) + ' live peers)', usd(m.category_anchor_tvl)),
          eqRow('Fitted cap/TVL at the anchor', mult(m.category_multiple)),
          eqRow('Regression base (β = ' + Number(m.beta || 0).toFixed(2) + ')', usd(m.base_value_usd)),
          eqRow('Robust flow (' + flowSource + ')', pct(m.flow_center) + ' ± ' + pct(m.flow_scale)),
          eqRow('This week ' + pct(r.change_7d) + ' → winsorized',
            pct(m.flow_used_pct) + ' (z ' + (m.flow_z === null || m.flow_z === undefined ? 'n/a' : Number(m.flow_z).toFixed(2)) + ')'),
          eqRow('Growth tilt', mult(m.growth_multiplier)),
          eqRow('Stale-week penalty' + (m.flow_stale ? ' (applied)' : ''), mult(m.outlier_penalty)),
          eqRow('Launch velocity' + (Number(m.velocity_boost_pct || 0) > 0 ? ' (+' + Math.round(m.velocity_boost_pct) + '%)' : ''),
            mult(m.velocity_multiplier)),
          eqRow('Chain concentration (' + (m.chain_count || 0) + ' chain' + (m.chain_count === 1 ? '' : 's') + ')',
            mult(m.concentration_multiplier)),
          eqRow('Maturity (' + age(r.age_days) + ')', mult(m.maturity_multiplier)),
          eqRow('Implied value', usd(shownValue(r)), 'tot')),
        el('p', { class: 'sub' },
          'The product of the terms above is ' + usd(computed) +
          (computed === shownValue(r) ? ', the figure in the table.' : ', against the table’s ' + usd(shownValue(r)) + '.') +
          ' The fit uses ' + (m.category_fallback
            ? 'the global fallback: no live peer in this category'
            : (m.category_peers || 0) + ' live comparable' + (m.category_peers === 1 ? '' : 's') + ' in this category') + '.')),
      el('section', { class: 'card' }, el('h3', null, 'Every component'), breakdown(r)),
      el('section', { class: 'card' },
        el('h3', null, 'Category comparables'),
        peers.length
          ? el('table', { class: 'peers' },
              el('thead', null, el('tr', null,
                el('th', { scope: 'col', text: 'Live protocol' }),
                el('th', { scope: 'col', class: 'r', text: 'TVL' }),
                el('th', { scope: 'col', class: 'r', text: 'Market cap' }),
                el('th', { scope: 'col', class: 'r', text: 'Model cap' }),
                el('th', { scope: 'col', class: 'r', text: 'Cap/TVL' }))),
              el('tbody', null, peers.map(function (p) {
                return el('tr', null,
                  el('td', null, p.name),
                  el('td', { class: 'r' }, usd(p.tvl_usd)),
                  el('td', { class: 'r' }, usd(p.mcap_usd)),
                  el('td', { class: 'r' }, usd(p.predicted_mcap_usd)),
                  el('td', { class: 'r' }, mult(p.multiple)));
              })))
          : el('p', { class: 'sub' }, 'No live protocol in this category, so the global fit answered for it.')));

    var right = el('div', { class: 'dcol' },
      el('section', { class: 'card' },
        el('h3', null, 'How to farm it'),
        el('p', { class: 'sub' }, 'Seven steps, each with what it costs and how long it takes, derived from this ' +
          'protocol’s own category, chains, TVL and age — never from a hand-written list of names.'),
        el('ol', { class: 'steps' }, steps.map(stepItem))),
      el('section', { class: 'card' },
        el('h3', null, 'Read the record'),
        el('p', { class: 'sub' },
          'Records no token: market cap ' + (r.mcap_usd === null ? 'not recorded' : usd(r.mcap_usd)) +
          ', CoinGecko id ' + (r.gecko_id === null ? 'absent' : 'present') +
          ', symbol ' + (r.symbol === null ? 'absent' : 'present') +
          '. That is what the snapshot says; it is not proof that no token exists. Chains: ' +
          ((r.chains || []).join(', ') || 'not recorded') + '.'),
        el('p', { class: 'sub' }, originSentence(r))));

    return el('div', { class: 'shell' },
      topBar(),
      el('a', {
        class: 'back', href: '#', onclick: function (e) {
          e.preventDefault(); state.open = null; writeHash(); render();
        }
      }, '← Back to the board'),
      el('header', { class: 'dhead' },
        el('div', null,
          el('div', { class: 'eyebrow' },
            chip('rank ' + r.rank + ' of ' + D.board_size, 'wl'),
            chip(r.category || 'Other'),
            originChip(r)),
          el('h1', null, r.name),
          el('div', { class: 'where' },
            (r.category || 'Other') + ' · ' + ((r.chains || []).join(' / ') || 'no chain recorded') +
            ' · first tracked ' + (r.listed_at || 'unknown'))),
        el('div', { class: 'big' },
          el('div', { class: 'v' }, usd(shownValue(r))),
          el('div', { class: 'k' }, 'implied launch value'))),
      el('div', { class: 'dgrid' }, left, right),
      el('div', { class: 'jump' },
        prev
          ? el('a', {
              href: '#p=' + encodeURIComponent(prev.slug),
              onclick: function (e) { e.preventDefault(); openDetail(prev.slug); }
            }, '← #' + prev.rank + ' ' + prev.name)
          : el('span'),
        next
          ? el('a', {
              class: 'next', href: '#p=' + encodeURIComponent(next.slug),
              onclick: function (e) { e.preventDefault(); openDetail(next.slug); }
            }, '#' + next.rank + ' ' + next.name + ' →')
          : el('span')),
      foot());
  }

  // Renders window.BACKTEST: no statistic is recomputed, and each interval is drawn on a -1..1 axis.

  /** A horizontal -1..1 axis with the interval band and its point estimate. */
  function intervalBar(ic) {
    if (!ic || ic.point === null || ic.point === undefined) return el('span', { class: 'dim' }, 'not available');
    function at(v) { return Math.max(0, Math.min(100, ((v + 1) / 2) * 100)); }
    var lo = at(ic.lo), hi = at(ic.hi), point = at(ic.point);
    return el('div', {
      class: 'icbar',
      role: 'img',
      'aria-label': 'Rank IC ' + ic.point + ', interval ' + ic.lo + ' to ' + ic.hi
    },
      el('span', { class: 'band', style: 'left:' + lo.toFixed(1) + '%;width:' + Math.max(0.6, hi - lo).toFixed(1) + '%', 'aria-hidden': 'true' }),
      el('span', { class: 'zero', 'aria-hidden': 'true' }),
      el('span', { class: 'point', style: 'left:' + point.toFixed(1) + '%', 'aria-hidden': 'true' }));
  }

  function icRow(label, block, note) {
    var ic = block.rank_ic;
    return el('div', { class: 'icrow' },
      el('div', { class: 'icname' }, label, el('span', { class: 'dim' }, ' ' + note)),
      intervalBar(ic),
      el('div', { class: 'icval' },
        signed3(ic.point),
        el('span', { class: 'dim' }, ' [' + signed3(ic.lo) + ', ' + signed3(ic.hi) + ']')));
  }

  function validationView() {
    var head = el('div', { class: 'shell' }, topBar());
    if (!V) {
      return el('div', null, head,
        el('section', { class: 'panel' },
          el('div', { class: 'empty' },
            el('h2', null, 'No validation report in this build'),
            el('p', null, 'The harness runs as node main.ts --backtest, writing backtest.json; a board run ' +
              'embeds the same report beside data.js, which is where this tab reads it.'))),
        el('div', { class: 'shell' }, foot()));
    }
    var lf = V.leak_free;
    var fm = V.full_model;
    var sp = V.split;
    var rep = V.repeated_splits;
    var lfq = lf.top_quartile;

    var statistical = el('section', { class: 'card' },
      el('h3', null, 'Rank IC, held out'),
      el('p', { class: 'sub' }, 'Spearman’s rho between the score and the protocol’s own 7-day TVL flow, ' +
        'with a ' + Math.round(V.bootstrap.level * 100) + '% percentile bootstrap over ' + lf.rank_ic.samples +
        ' resamples. Zero is the middle of the axis: an interval that crosses it carries no usable signal.'),
      icRow('Leak-free', lf, '(growth, stale and velocity weights at zero)'),
      icRow('Shipped fit', fm, '(reads the label; a leakage control only)'),
      el('p', { class: 'sub' },
        'Leakage gap ' + signed3(fm.leakage_gap) + ': the shipped configuration reads the label through the growth, ' +
        'stale-week and velocity tilts, so its IC is not evidence. The gap is reported as measured rather than assumed.'),
      el('p', { class: 'sub' },
        'Top-quartile picks: ' + lfq.picks + ' rows, ' + lfq.hits + ' in the realized top quartile (' +
        (lfq.rate === null ? 'n/a' : (lfq.rate * 100).toFixed(1) + '%') + ' against a ' +
        (lfq.base_rate * 100).toFixed(1) + '% blind rate, a lift of ' + signed3(lfq.lift) + ').'));

    var splits = el('section', { class: 'card' },
      el('h3', null, 'Independent splits'),
      el('p', { class: 'sub' }, 'One holdout cannot separate “no signal” from an unlucky split, so the same design ' +
        'is replayed over ' + rep.splits + ' seeds. Mean ' + signed3(rep.mean_ic) + ', median ' + signed3(rep.median_ic) +
        ', range ' + signed3(rep.min_ic) + ' to ' + signed3(rep.max_ic) + '; ' +
        (rep.share_positive === null ? 'n/a' : Math.round(rep.share_positive * 100) + '%') + ' above zero.'),
      el('div', { class: 'splitlist' }, rep.ics.map(function (e) {
        return el('div', { class: 'splitrow' },
          el('span', { class: 'dim' }, 'seed ' + e.seed),
          el('span', { class: 'r ' + tone(e.ic) }, signed3(e.ic)));
      })),
      el('p', { class: 'sub' }, 'Bootstrap CIs cover noise inside a split; these cover the choice of split itself. ' +
        'They answer different questions, so they are reported side by side.'));

    var design = el('section', { class: 'card' },
      el('h3', null, 'The design'),
      el('p', { class: 'sub' }, V.design + '.'),
      el('div', { class: 'catrows' },
        el('div', { class: 'catrow cathead', 'aria-hidden': 'true' },
          el('span', { class: 'c', text: 'Split' }), el('span', { class: 'n', text: 'Rows' })),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Train half'), el('span', { class: 'n' }, String(sp.train_protocols))),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Test half'), el('span', { class: 'n' }, String(sp.test_protocols))),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Live peers in the train half'), el('span', { class: 'n' }, String(sp.train_live_peers))),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Scored test rows'), el('span', { class: 'n' }, String(sp.scored_rows))),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Scored categories'), el('span', { class: 'n' }, String(sp.scored_categories))),
        el('div', { class: 'catrow' }, el('span', { class: 'c' }, 'Of those, on the global fallback'), el('span', { class: 'n' }, String(sp.scored_categories_no_live_peer)))),
      el('p', { class: 'sub' }, 'The fit is rebuilt on the train half alone, so neither the slope, the category ' +
        'anchors nor the flow spread has seen a row it later scores.'));

    var byCategory = el('section', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' }, 'Rank IC inside each held-out category, leak-free. Small buckets are noisy by ' +
            'construction: read the row count before the rho.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', class: 'r', text: 'Rows' }),
            el('th', { scope: 'col', class: 'r', text: 'Rank IC' }))),
          el('tbody', null, V.by_category.map(function (c) {
            return el('tr', null,
              el('td', null, c.category),
              el('td', { class: 'r' }, String(c.rows)),
              el('td', { class: 'r ' + tone(c.rho) }, signed3(c.rho)));
          })))));

    var warnings = V.warnings.length === 0
      ? el('p', { class: 'sub' }, 'No warnings: this split cleared every check the harness applies.')
      : el('ul', { class: 'warn' }, V.warnings.map(function (w) { return el('li', null, w); }));

    return el('div', null, head,
      el('section', { class: 'hero' },
        el('div', null,
          el('div', { class: 'kicker' }, 'OUT-OF-SAMPLE CHECK'),
          el('h1', null, 'Does the ranking hold up on rows the fit never saw?'),
          el('p', { class: 'lede' },
            'Every category is split in half by a seeded hash of the slug; the comparables fit and the robust flow ' +
            'are rebuilt on the train half alone, and the test half is scored against its own seven-day TVL flow — ' +
            'the only forward-looking field the sealed snapshot carries. The headline ranking is leak-free: growth, ' +
            'the stale-week penalty and velocity all read that same field, so they are switched off before the ' +
            'comparison rather than allowed to score themselves.')),
        el('div', { class: 'stats' },
          stat(sp.scored_rows, 'held-out rows scored'),
          stat(signed3(lf.rank_ic.point), 'leak-free rank IC'),
          stat(lfq.rate === null ? 'n/a' : (lfq.rate * 100).toFixed(0) + '%', 'top-quartile hit rate'),
          stat((lfq.base_rate * 100).toFixed(0) + '%', 'blind-pick base rate'),
          stat(signed3(fm.leakage_gap), 'leakage gap'),
          stat(rep.splits, 'independent splits'))),
      el('div', { class: 'notes' }, statistical, splits),
      el('div', { class: 'notes' }, design, el('section', { class: 'card' },
        el('h3', null, 'Warnings'),
        el('p', { class: 'sub' }, 'What the harness itself flags about this split:'),
        warnings)),
      byCategory,
      el('div', { class: 'shell' }, foot()));
  }

  function boardView() {
    rebuildRanks();
    hosts.table = el('div');
    hosts.table.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    return el('div', { class: 'shell' },
      topBar(),
      hero(),
      controls(),
      state.tab === 'pre' ? weightPanel() : null,
      hosts.table,
      state.tab === 'pre' ? modelNotes() : null,
      foot());
  }

  function render() {
    app.textContent = '';
    app.setAttribute('aria-busy', 'false');
    if (state.panel === 'validation') {
      app.appendChild(validationView());
      return;
    }
    if (state.open) {
      var row = null;
      for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.open) { row = D.rows[i]; break; }
      if (row) {
        app.appendChild(detailView(row));
        return;
      }
      state.open = null;
    }
    app.appendChild(boardView());
  }

  // Keyboard: j/k step between the visible rows, Enter opens the focused row (its own handler),
  // Escape leaves the detail view. Typing in a field or a modifier combination is left alone.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'Escape') {
      if (state.open) { state.open = null; writeHash(); render(); }
      return;
    }
    if (e.key !== 'j' && e.key !== 'k') return;
    var rows = app.querySelectorAll('tbody tr:not(.bdrow)');
    if (!rows.length) return;
    e.preventDefault();
    var at = Array.prototype.indexOf.call(rows, document.activeElement);
    var to = e.key === 'j' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[to].focus();
    rows[to].scrollIntoView({ block: 'nearest' });
  });

  readHash();
  render();

  // A hand-edited hash is a fresh view: drop every filter, then read whatever the hash carries.
  window.addEventListener('hashchange', function () {
    state = { panel: 'board', tab: 'pre', q: '', cat: 'all', origin: 'all', sort: 'rank', dir: 1, open: null, exp: null };
    readHash();
    render();
  });
})();
