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
  var state = { q: '', category: 'all', origin: 'all', tab: 'pre', sort: 'rank', dir: 1, selected: null, expanded: null };

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

  // ---- the score's weights: the board's own components, re-combined in this page ----
  // Every tilt enters the score as an exponent on its stored multiplier, so the default weight of
  // 1 reproduces board.json's own ranking exactly and 0 switches that tilt off. Nothing is fetched.
  var TILTS = [
    { key: 'flow', label: '7d flow tilt', hint: 'the growth multiplier on the comparables base' },
    { key: 'outlier', label: 'Stale-week penalty', hint: 'damps a flow beyond ±' + MODEL.flow_winsor + ' robust sigmas' },
    { key: 'velocity', label: 'Launch velocity', hint: 'bounded boost for outgrowing the category' },
    { key: 'concentration', label: 'Chain concentration', hint: 'discount for a single-chain record' },
    { key: 'maturity', label: 'Maturity tilt', hint: 'time since DefiLlama began tracking' }
  ];
  var DEFAULT_WEIGHTS = { flow: 1, outlier: 1, velocity: 1, concentration: 1, maturity: 1 };
  var weights = { flow: 1, outlier: 1, velocity: 1, concentration: 1, maturity: 1 };
  var weightedRank = null;   // slug -> rank, only while the weights differ from the board's own
  var tableHost = null;      // the table the sliders repaint, so a drag never loses the slider
  var countB = null;
  var weightStatus = null;
  var resetButton = null;

  function fmtWeight(n) { return '×' + Number(n).toFixed(2); }
  function weightsDefault() {
    return TILTS.every(function (t) { return weights[t.key] === DEFAULT_WEIGHTS[t.key]; });
  }
  function num(n) { return n === null || n === undefined ? 1 : Number(n); }
  /** The score at the current weights: the stored terms, each raised to its weight. */
  function scoreFor(r, w) {
    var m = r.model || {};
    var s = (m.base_value_usd || 0) *
      Math.pow(num(m.growth_multiplier), w.flow) *
      Math.pow(num(m.outlier_penalty), w.outlier) *
      Math.pow(num(m.velocity_multiplier), w.velocity) *
      Math.pow(num(m.concentration_multiplier), w.concentration) *
      Math.pow(num(m.maturity_multiplier), w.maturity);
    return Math.max(1, Math.round(s));
  }
  function shownValue(r) { return weightedRank ? scoreFor(r, weights) : r.implied_value_usd; }
  function shownMultiple(r) { return r.tvl_usd > 0 ? shownValue(r) / r.tvl_usd : 0; }
  function displayedRank(r) { return weightedRank && weightedRank[r.slug] ? weightedRank[r.slug] : r.rank; }
  function rankMove(r) {
    if (!weightedRank) return null;
    var moved = r.rank - displayedRank(r);
    if (!moved) return null;
    return el('span', {
      class: 'move ' + (moved > 0 ? 'up' : 'down'),
      title: 'Rank ' + r.rank + ' under the model’s own weights'
    }, (moved > 0 ? ' ↑' : ' ↓') + Math.abs(moved));
  }
  function refreshWeightedRank() {
    if (weightsDefault()) { weightedRank = null; return; }
    var map = {};
    D.rows.slice().sort(function (a, b) {
      var d = scoreFor(b, weights) - scoreFor(a, weights);
      if (d) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    }).forEach(function (r, i) { map[r.slug] = i + 1; });
    weightedRank = map;
  }
  function resetWeights() {
    TILTS.forEach(function (t) { weights[t.key] = DEFAULT_WEIGHTS[t.key]; });
    refreshWeightedRank();
    render();
  }
  function paintBoard() {
    if (tableHost) {
      tableHost.textContent = '';
      tableHost.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    }
    if (countB) countB.textContent = String(state.tab === 'live' ? liveRows().length : boardRows().length);
    if (weightStatus) weightStatus.textContent = weightsDefault()
      ? 'every tilt at ×1.00: this is board.json’s own ranking'
      : 're-ranked in this page from the stored components';
    if (resetButton) resetButton.disabled = weightsDefault();
  }
  function toggleExpand(slug) {
    state.expanded = state.expanded === slug ? null : slug;
    writeHash();
    paintBoard();
    var buttons = tableHost ? tableHost.querySelectorAll('button.exp') : [];
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-slug') === slug) { buttons[i].focus(); break; }
    }
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
    if (p.get('x')) state.expanded = p.get('x');
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
    if (state.expanded) p.set('x', state.expanded);
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
      else if (key === 'implied') { av = shownValue(a); bv = shownValue(b); }
      else { av = displayedRank(a); bv = displayedRank(b); }
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
          ' at or above the floor that the list leaves out. Each base value is a log-log comparables regression over the snapshot’s ',
          el('b', null, String(D.live_size)),
          ' live-token protocols, fitted inside each category against its median TVL. A winsorized seven-day flow tilts that base, a robust median/MAD test damps any stale outlier week, faster-than-category growth earns a bounded velocity boost and a single-chain record takes a concentration discount. The weight sliders re-rank every row live from those stored terms. A record that carries no token is not proof there is none.'
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

    countB = el('b', null, String(state.tab === 'live' ? liveRows().length : boardRows().length));
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
      el('span', { class: 'count' }, countB, ' rows shown')
    );
  }

  /** The weight sliders: the same components, re-combined, with the ranking following the drag. */
  function weightPanel() {
    weightStatus = el('span', { class: 'wstat' }, weightsDefault()
      ? 'every tilt at ×1.00: this is board.json’s own ranking'
      : 're-ranked in this page from the stored components');
    resetButton = el('button', { type: 'button', class: 'button', text: 'Reset weights', onclick: resetWeights });
    resetButton.disabled = weightsDefault();
    return el('div', { class: 'weights' },
      el('span', { class: 'wtitle' }, 'Score weights'),
      TILTS.map(function (t) {
        var out = el('span', { class: 'wv' }, fmtWeight(weights[t.key]));
        var input = el('input', {
          type: 'range', min: '0', max: '2', step: '0.25', value: String(weights[t.key]),
          'aria-label': t.label + ' weight', title: t.hint
        });
        input.addEventListener('input', function () {
          weights[t.key] = Number(input.value);
          out.textContent = fmtWeight(weights[t.key]);
          refreshWeightedRank();
          paintBoard();
        });
        return el('label', null, el('span', { text: t.label }), input, out);
      }),
      weightStatus,
      el('span', { class: 'reset' }, resetButton)
    );
  }

  /** One row's arithmetic, every term read from board.json and none of it fetched. */
  function breakdown(r) {
    var m = r.model || {};
    var grid = el('div', { class: 'calc' });
    function line(k, d, v, cls) {
      grid.appendChild(el('div', { class: 'k ' + (cls || '') }, k));
      grid.appendChild(el('div',{ class: 'd '+ (cls || '')}, d));
      grid.appendChild(el('div', { class: 'v ' + (cls || '') }, v));
    }
    var stale = m.flow_stale;
    line(
      'Base comparables',
      'anchor ' + fmtUsd(m.category_anchor_tvl) + ' × ' + fmtMult(m.category_multiple) +
        ' at that anchor × (TVL / anchor)^β — ' + (m.category_fallback
          ? 'no live peer in this category, so the global fit'
          : (m.category_peers || 0) + ' live comparable' + (m.category_peers === 1 ? '' : 's')),
      fmtUsd(m.base_value_usd)
    );
    line(
      'Category adjustment',
      'the anchor is the median TVL of every ' + (r.category || 'Other') + ' row the snapshot lists: ' + fmtUsd(m.category_anchor_tvl),
      fmtMult(m.category_multiple)
    );
    line(
      'Flow adjustment',
      fmtPct(m.flow_center) + ' ± ' + fmtPct(m.flow_scale) + ' robust ' + (m.flow_fallback ? 'global' : (r.category || 'category')) +
        ' baseline; this week ' + fmtPct(r.change_7d) + ' → winsorized ' + fmtPct(m.flow_used_pct) +
        ' (z ' + (m.flow_z === null || m.flow_z === undefined ? 'n/a' : Number(m.flow_z).toFixed(2)) + ')',
      fmtMult(m.growth_multiplier)
    );
    line(
      'Stale-week penalty',
      stale ? 'this flow sits beyond ±' + MODEL.flow_winsor + ' robust sigmas of the baseline, so the result is damped'
        : 'no stale week: the flow is inside ±' + MODEL.flow_winsor + ' robust sigmas',
      fmtMult(m.outlier_penalty)
    );
    line(
      'Launch velocity',
      stale ? 'a stale week is damped by the outlier penalty, so it earns no velocity credit'
        : Number(m.velocity_boost_pct || 0) > 0
          ? '+' + Number(m.velocity_boost_pct).toFixed(0) + '% faster than its category’s flow centre (z ' + Number(m.velocity_z || 0).toFixed(2) + ', capped at ' + MODEL.velocity_cap + ')'
          : 'at or below its category’s flow centre: no boost, and never a penalty',
      fmtMult(m.velocity_multiplier)
    );
    line(
      'Chain concentration',
      (m.chain_count || 0) + ' chain' + (m.chain_count === 1 ? '' : 's') + ' on record' +
        (m.concentration_single ? ' — a single-chain record, so the value is discounted' : ''),
      fmtMult(m.concentration_multiplier)
    );
    line(
      'Maturity tilt',
      fmtAge(r.age_days) + ' on record; an unknown age counts as ' + MODEL.unknown_age_days + ' days',
      fmtMult(m.maturity_multiplier)
    );
    line(
      'Weights in this page',
      'flow ' + fmtWeight(weights.flow) + ', outlier ' + fmtWeight(weights.outlier) + ', velocity ' + fmtWeight(weights.velocity) +
        ', concentration ' + fmtWeight(weights.concentration) + ', maturity ' + fmtWeight(weights.maturity),
      ''
    );
    line(
      'Final score',
      'base × growth^w × outlier^w × velocity^w × concentration^w × maturity^w',
      fmtUsd(shownValue(r)),
      'tot'
    );
    if (weightedRank) {
      line('Model’s own score', 'board.json rank #' + r.rank + ' at every tilt ×1.00', fmtUsd(r.implied_value_usd), 'tot');
    }
    return el('div', { class: 'bd' },
      el('p', { class: 'sub' }, 'Score components for ' + r.name + ' — every term below is stored in board.json; the page computes nothing it was not given.'),
      grid
    );
  }

  // ---- the score path: the order the model applies its own tilts ----
  // The snapshot is one point in time, so there is no weekly score series to plot. What the stored
  // components do derive is the order the model applies its tilts, each a multiplier on the running
  // value, and the page can draw that path without inventing a single data point.
  var SCORE_STAGES = [
    { key: 'growth_multiplier', label: 'Flow', note: '7d robust-flow growth tilt' },
    { key: 'outlier_penalty', label: 'Stale', note: 'stale-week penalty' },
    { key: 'velocity_multiplier', label: 'Velocity', note: 'launch-velocity boost' },
    { key: 'concentration_multiplier', label: 'Chain', note: 'single-chain concentration discount' },
    { key: 'maturity_multiplier', label: 'Maturity', note: 'age tilt' }
  ];

  /** The cumulative multiplier after each tilt, with the comparables base as stage zero. */
  function scorePath(r) {
    var m = r.model || {};
    var base = m.base_value_usd || 0;
    var path = [{ label: 'Base', note: 'comparables regression', mult: 1, value: base }];
    var running = 1;
    SCORE_STAGES.forEach(function (stage) {
      var mult = num(m[stage.key]);
      running *= mult;
      path.push({ label: stage.label, note: stage.note, mult: mult, value: base * running });
    });
    return path;
  }

  /** A column sparkline of the cumulative path; the table under it carries the exact values. */
  function sparkline(r) {
    var path = scorePath(r);
    var mults = path.map(function (p) { return p.mult; });
    var lo = Math.min.apply(null, mults);
    var hi = Math.max.apply(null, mults);
    if (hi - lo < 0.04) { var mid = (hi + lo) / 2; lo = mid - 0.02; hi = mid + 0.02; }
    function at(mult) { return 4 + ((mult - lo) / (hi - lo)) * 92; }
    var summary = 'Score path from the comparables base: ' + path.slice(1).map(function (p) {
      return p.label + ' ' + fmtMult(p.mult);
    }).join(', ') + ' — a final tilt of ' + fmtMult(path[path.length - 1].mult) + ' on the base.';
    return el('div', { class: 'spark' },
      el('div', { class: 'spark-plot', role: 'img', 'aria-label': summary },
        el('span', { class: 'spark-ref', style: 'bottom:' + at(1).toFixed(1) + '%', 'aria-hidden': 'true' }),
        path.map(function (p, i) {
          return el('div', {
            class: 'spark-col' + (i === path.length - 1 ? ' last' : ''),
            title: p.label + ' — ' + p.note + ': ' + fmtMult(p.mult) + ', running ' + fmtUsd(p.value)
          }, el('i', { style: 'height:' + at(p.mult).toFixed(1) + '%' }));
        })
      ),
      el('div', { class: 'spark-labels', 'aria-hidden': 'true' },
        path.map(function (p) { return el('span', null, p.label); })
      )
    );
  }

  /** The path as a chart plus its table twin: the table carries every exact value. */
  function scorePathCard(r) {
    var path = scorePath(r);
    return el('section', { class: 'card' },
      el('h3', null, 'Score path'),
      el('p', { class: 'sub' }, 'The snapshot is a single point in time, so this is not a weekly history: it is the order the model applies its stored tilts to the comparables base, each one a multiplier on the running value. The hairline marks ×1.00, where a tilt leaves the score unchanged.'),
      sparkline(r),
      el('table', { class: 'path' },
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Stage' }),
          el('th', { scope: 'col', class: 'r', text: 'Tilt' }),
          el('th', { scope: 'col', class: 'r', text: 'Running value' })
        )),
        el('tbody', null, path.map(function (p, i) {
          return el('tr', { class: i === path.length - 1 ? 'last' : null },
            el('td', null, p.label, i === 0 ? null : el('span', { class: 'dim' }, ' · ' + p.note)),
            el('td', { class: 'r' }, i === 0 ? 'base' : fmtMult(p.mult)),
            el('td', { class: 'r' }, fmtUsd(p.value))
          );
        }))
      )
    );
  }

  /** Why the launch-velocity multiplier is what it is, in this row's own numbers. */
  function velocityNote(r) {
    var m = r.model || {};
    var z = m.flow_z === null || m.flow_z === undefined ? null : Number(m.flow_z);
    if (z === null) {
      return 'Launch velocity: no 7-day flow is recorded, so the multiplier is ×1.00. The signal only rewards growth above the category’s own robust flow centre, and it never subtracts.';
    }
    if (m.flow_stale) {
      return 'Launch velocity: none this week. The flow is a stale outlier (z ' + z.toFixed(2) + ', beyond ±' + MODEL.flow_winsor + ' robust sigmas), so the outlier penalty damps the score and the stale week earns no velocity credit on top.';
    }
    if (Number(m.velocity_boost_pct) > 0) {
      return 'Launch velocity: the 7-day TVL flow beats its category’s robust centre by ' + z.toFixed(2) + ' sigmas, capped at ' + MODEL.velocity_cap + ', so the score earns a bounded boost of +' + Number(m.velocity_boost_pct).toFixed(0) + '% (' + fmtMult(m.velocity_multiplier) + '). A flow at or below the centre earns ×1.00.';
    }
    return 'Launch velocity: the flow sits at or below the category’s robust centre (z ' + z.toFixed(2) + '), so the multiplier is ×1.00. The signal never penalises; the outlier test owns the downside.';
  }

  /** Why the concentration multiplier is what it is: the snapshot's chain record is the proxy. */
  function concentrationNote(r) {
    var m = r.model || {};
    var chains = r.chains || [];
    var count = m.chain_count || chains.length;
    var shown = chains.slice(0, 4).join(', ') + (chains.length > 4 ? ' and ' + (chains.length - 4) + ' more' : '');
    if (m.concentration_single) {
      return 'Chain concentration: the snapshot lists a single chain (' + (shown || 'no chain recorded') + '), so the score takes a ×' + Number(m.concentration_multiplier).toFixed(2) + ' discount. The snapshot records which chains a protocol runs on but not how its TVL splits across them, so a one-chain record is the only concentration proxy it carries.';
    }
    return 'Chain concentration: ' + count + ' chains on record (' + (shown || 'no chain recorded') + '), so the multiplier is ×' + Number(m.concentration_multiplier).toFixed(2) + '. Per-chain TVL is not in the snapshot, so chain count is the proxy.';
  }

  /** The two launch signals, stated in full for this row. */
  function signalsCard(r) {
    return el('section', { class: 'card' },
      el('h3', null, 'Launch signals'),
      el('p', { class: 'sub' }, velocityNote(r)),
      el('p', { class: 'sub' }, concentrationNote(r)),
      el('p', { class: 'sub' }, 'Both signals are folded into the score and, like every other tilt, can be re-weighted from the sliders above the board.')
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
    var cap = Math.max.apply(null, list.map(function (r) { return shownValue(r); }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var open = state.expanded === r.slug;
      tbody.appendChild(el('tr', rowAttrs(r),
        el('td', { class: 'rank' },
          el('button', {
            type: 'button', class: 'exp', 'data-slug': r.slug,
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': (open ? 'Hide' : 'Show') + ' score components for ' + r.name,
            title: 'Show every component of this score',
            onclick: function (e) { e.stopPropagation(); toggleExpand(r.slug); },
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }
          }, open ? '▾' : '▸'),
          el('b', null, '#' + displayedRank(r)),
          rankMove(r)
        ),
        el('td', null, el('div', { class: 'who' },
          el('b', null, r.name),
          el('span', null, (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 2).join(' / ') || 'chain unnamed'))
        )),
        el('td', { class: 'r' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'r ' + tone(r.change_7d) }, fmtPct(r.change_7d),
          r.model.flow_stale
            ? el('span', {
                class: 'stale',
                title: 'Stale flow: winsorized at ±' + MODEL.flow_winsor + ' robust sigmas; the result is damped by ' + fmtMult(r.model.outlier_penalty) + '.',
              }, ' ⚠')
            : null),
        el('td', { class: 'r' }, fmtAge(r.age_days)),
        el('td', {
          class: 'r',
          title: 'Base ' + fmtMult(r.model.base_multiple) + ' → growth ' + fmtMult(r.model.growth_multiplier) +
            ', outlier ' + fmtMult(r.model.outlier_penalty) + ', velocity ' + fmtMult(r.model.velocity_multiplier) +
            ', concentration ' + fmtMult(r.model.concentration_multiplier) + ', maturity ' + fmtMult(r.model.maturity_multiplier),
        }, fmtMult(shownMultiple(r))),
        el('td', null, valueCell(shownValue(r), cap, false)),
        el('td', null, originChip(r))
      ));
      if (open) {
        tbody.appendChild(el('tr', { class: 'bdrow' },
          el('td', { colspan: '8' }, breakdown(r))
        ));
      }
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'wrap' },
        el('table', null,
          el('caption', { class: 'sub' }, 'Strongest score first. Expand any row (▸) to see every component of its score; select the row itself to audit its comparables, its arithmetic and its farm plan.'),
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
    var r = D.regression;
    var formula = 'base     = anchor × multiple × (TVL / anchor)^β   β = ' + r.beta + ' from ' + r.pairs + ' peer pairs' +
      '\nβ        = median within-category Theil-Sen; TVL ratio ≥ ' + m.beta_min_ratio + ', clamp [' + m.beta_floor + ', ' + m.beta_cap + ']' +
      '\nanchor   = category median TVL over all snapshot rows' +
      '\nmultiple = median log(cap/TVL) at anchor, shrunk with ' + m.multiple_prior_weight + ' prior peers toward equal-category median' +
      '\nflow     = median ± ' + m.flow_winsor + ' × max(' + m.flow_scale_floor + '%, 1.4826 × MAD); global if peers < ' + m.flow_min_peers +
      '\ngrowth   = 1 + clamp(winsorized flow, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight +
      '\noutlier  = clamp(1 − ' + m.flow_penalty_step + ' × max(0, |z| − ' + m.flow_winsor + '), ' + m.flow_penalty_floor + ', ' + m.flow_penalty_cap + ')' +
      '\nvelocity = 1 + min(max(z, 0), ' + m.velocity_cap + ') × ' + m.velocity_weight + '   faster than the category only, never a penalty' +
      '\nconcentr = ' + m.concentration_single_mult + ' if the snapshot lists a single chain, else 1' +
      '\nmaturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '   unknown age: ' + m.unknown_age_days + 'd' +
      '\nimplied  = round(base × growth × outlier × velocity × concentr × maturity)';
    return el('section', { class: 'notes' },
      el('div', { class: 'card' },
        el('h3', null, 'The value model'),
        el('div', { class: 'formula' }, formula),
        el('p', { class: 'sub' },
          'One function scores every row and no protocol name is special-cased. The regression is fitted to the ',
          String(D.live_size),
          ' live-token protocols in the snapshot, inside each category, so a category’s own median TVL is the anchor rather than one peer’s market cap. The global fallback fit puts cap/TVL at ',
          fmtMult(r.multiple_at_anchor) + ' at the $' + (r.anchor_tvl_usd / 1e6).toFixed(1) + 'M global anchor (log multiple ' + r.log_multiple_at_anchor + '). ',
          'The seven-day flow is winsorized at ',
          String(m.flow_winsor) + ' robust sigmas (median ± 1.4826 × MAD)',
          ' and clipped to ' + String(m.growth_floor) + '%..+' + String(m.growth_cap) + '%, so one stale week cannot dominate. A flow above its category’s own robust centre earns a bounded launch-velocity boost (at most ×' +
          (1 + m.velocity_cap * m.velocity_weight).toFixed(2) + '), and a protocol whose snapshot record lists a single chain takes a ×' + m.concentration_single_mult + ' concentration discount. Age is the time since DefiLlama began tracking the protocol; an unknown age uses ',
          String(m.unknown_age_days) + ' days. The weight sliders above the board re-rank it from these same stored components, so any alternative weighting is reproducible in the page, offline.'
        )
      ),
      el('div', { class: 'card' },
        el('h3', null, 'Category fits'),
        el('p', { class: 'sub' }, 'Live peers, the category anchor (median TVL over every row the snapshot lists there) and the cap/TVL the fit implies at that anchor:'),
        el('div', { class: 'catrows' },
          el('div', { class: 'catrow cathead', 'aria-hidden': 'true' },
            el('span', { class: 'c', text: 'Category' }),
            el('span', { class: 'n', text: 'Peers' }),
            el('span', { class: 'a', text: 'TVL anchor' }),
            el('span', { class: 'm', text: 'Fit cap/TVL' })
          ),
          D.categories.slice(0, 18).map(function (c) {
            return el('div', { class: 'catrow' },
              el('span', { class: 'c', text: c.category }),
              el('span', { class: 'n', text: String(c.peers) }),
              el('span', { class: 'a', text: fmtUsd(c.anchor_tvl_usd) }),
              el('span', { class: 'm', text: fmtMult(c.multiple_at_anchor) })
            );
          })
        ),
        el('p', { class: 'sub' }, String(D.categories.length) + ' categories in all; each detail view names its own peers and fitted terms.')
      )
    );
  }

  // ---- the detail view ----
  function detailFor(r) {
    var live = r.token_status !== 'pre-token';
    var m = r.model || {};
    var calc = Math.max(1, Math.round((m.base_value_usd || 0) * (m.growth_multiplier || 0) * (m.outlier_penalty || 0) *
      (m.velocity_multiplier || 1) * (m.concentration_multiplier || 1) * (m.maturity_multiplier || 0)));
    var steps = r.farm_steps || [];
    var peers = r.comparables || [];
    var flowSource = m.flow_fallback ? 'global robust baseline' : (r.category || 'category') + ' robust baseline';
    var fitSummary = m.category_fallback
      ? 'No live peer in this category; the global regression fit is used.'
      : 'The fit uses ' + (m.category_peers || 0) + ' live comparable' + (m.category_peers === 1 ? '' : 's') + ' and the all-protocol median-TVL anchor.';

    var left = el('div', { class: 'dcol' },
      el('section', { class: 'card' },
        el('h2', null, live ? 'What the market says' : 'What the model says'),
        el('p', { class: 'sub' }, live
          ? 'This protocol already trades. Its market cap is a market fact, not a model output, so it stays outside the pre-token ranking.'
          : 'A log-log comparables regression inside this category, then five tilts. Every term is shown, and the last line is recomputed from the displayed values.'),
        el('div', { class: 'kv' },
          el('div', null, el('div', { class: 'k' }, 'TVL'), el('div', { class: 'v' }, fmtUsd(r.tvl_usd))),
          el('div', null, el('div', { class: 'k' }, 'Seven-day TVL'), el('div', { class: 'v ' + tone(r.change_7d) }, fmtPct(r.change_7d))),
          el('div', null, el('div', { class: 'k' }, 'Age on record'), el('div', { class: 'v' }, fmtAge(r.age_days))),
          el('div', null, el('div', { class: 'k' }, 'Listed'), el('div', { class: 'v' }, r.listed_at || 'unknown'))
        ),
        live ? null : el('div', { class: 'eq' },
          el('div', { class: 'l' }, 'TVL anchor (' + (m.category_peers || 0) + ' live peers)'), el('div', { class: 'r' }, fmtUsd(m.category_anchor_tvl)),
          el('div', { class: 'l' }, 'Fitted cap/TVL at anchor'), el('div', { class: 'r' }, fmtMult(m.category_multiple)),
          el('div', { class: 'l' }, 'Regression base (β = ' + (m.beta || 0).toFixed(2) + ')'), el('div', { class: 'r' }, fmtUsd(m.base_value_usd)),
          el('div', { class: 'l' }, 'Robust flow baseline (' + flowSource + ')'), el('div', { class: 'r' }, fmtPct(m.flow_center) + ' ± ' + fmtPct(m.flow_scale)),
          el('div', { class: 'l' }, 'Seven-day flow: ' + fmtPct(r.change_7d) + ' → ' + fmtPct(m.flow_used_pct) + (m.flow_stale ? ' (winsorized)' : '')),
          el('div', { class: 'r' }, 'z = ' + (m.flow_z === null || m.flow_z === undefined ? 'n/a' : Number(m.flow_z).toFixed(2))),
          el('div', { class: 'l' }, 'Growth tilt'), el('div', { class: 'r' }, fmtMult(m.growth_multiplier)),
          el('div', { class: 'l' }, 'Outlier penalty' + (m.flow_stale ? ' (stale week)' : '')), el('div', { class: 'r' }, fmtMult(m.outlier_penalty)),
          el('div', { class: 'l' }, 'Launch velocity' + (m.flow_stale
            ? ' (stale week: damped, no velocity credit)'
            : Number(m.velocity_boost_pct || 0) > 0
              ? ' (+' + Number(m.velocity_boost_pct).toFixed(0) + '% vs its category centre)'
              : ' (at or below the centre)')),
          el('div', { class: 'r' }, fmtMult(m.velocity_multiplier)),
          el('div', { class: 'l' }, 'Chain concentration (' + (m.chain_count || 0) + ' chain' + (m.chain_count === 1 ? '' : 's') + ' on record)'),
          el('div', { class: 'r' }, fmtMult(m.concentration_multiplier)),
          el('div', { class: 'l' }, 'Maturity tilt (' + fmtAge(r.age_days) + ' on record)'), el('div', { class: 'r' }, fmtMult(m.maturity_multiplier)),
          el('div', { class: 'l total' }, 'Implied value'), el('div', { class: 'r total' }, fmtUsd(r.implied_value_usd))
        ),
        live ? null : el('p', { class: 'sub' },
          'Recomputed from the displayed terms: ' + fmtUsd(m.base_value_usd) + ' × ' + fmtMult(m.growth_multiplier) + ' × ' + fmtMult(m.outlier_penalty) +
          ' × ' + fmtMult(m.velocity_multiplier) + ' × ' + fmtMult(m.concentration_multiplier) + ' × ' + fmtMult(m.maturity_multiplier) + ' = ' + fmtUsd(calc) +
          (calc === r.implied_value_usd ? ', the number board.json carries. ' : ', which differs from the board’s ' + fmtUsd(r.implied_value_usd) + '. ') +
          fitSummary + ' The fitted category cap/TVL at its anchor is ' + fmtMult(m.category_multiple) + '.' +
          (m.flow_stale
            ? ' This week’s flow sits ' + Math.abs(Number(m.flow_z)).toFixed(1) + ' robust sigmas from the ' + flowSource + ', so the growth input is winsorized at ' + fmtPct(m.flow_used_pct) + ' and the penalty damps the result.'
            : ''))
      ),
      live ? null : scorePathCard(r),
      el('section', { class: 'card' },
        el('h3', null, 'Category comparables'),
        el('table', { class: 'peers' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Live protocol' }), el('th', { scope: 'col', class: 'r', text: 'TVL' }),
            el('th', { scope: 'col', class: 'r', text: 'Market cap' }), el('th', { scope: 'col', class: 'r', text: 'Model cap' }),
            el('th', { scope: 'col', class: 'r', text: 'Multiple' })
          )),
          el('tbody', null, peers.map(function (p) {
            return el('tr', null,
              el('td', null, p.name),
              el('td', { class: 'r' }, fmtUsd(p.tvl_usd)),
              el('td', { class: 'r' }, fmtUsd(p.mcap_usd)),
              el('td', { class: 'r' }, fmtUsd(p.predicted_mcap_usd)),
              el('td', { class: 'r' }, fmtMult(p.multiple))
            );
          }))
        ),
        peers.length ? null : el('p', { class: 'sub' }, 'No live protocol in this category: the global intercept and anchor are used instead.')
      )
    );

    var right = el('div', { class: 'dcol' },
      live ? null : signalsCard(r),
      el('section', { class: 'card' },
        el('h3', null, 'How to farm it'),
        el('p', { class: 'sub' }, 'The full plan board.json carries: ' + steps.length + ' concrete steps, each with its cost and its time, derived from the protocol’s own category, chains, TVL and age — never from a hand-written name list.'),
        el('ol', { class: 'steps' }, steps.map(function (s, i) {
          var cut = / Cost: (.*?)\. Time: (.*?)\.$/.exec(s);
          return el('li', null,
            el('span', { class: 'no' }, String(i + 1).padStart(2, '0')),
            el('div', null,
              el('p', { title: s },cut ? s.slice(0, cut.index) : s),
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
    refreshWeightedRank();
    tableHost = el('div');
    tableHost.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    return el('div', { class: 'shell' }, topBar(), hero(), controls(),
      state.tab === 'pre' ? weightPanel() : null,
      tableHost,
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
    state = { q: '', category: 'all', origin: 'all', tab: 'pre', sort: 'rank', dir: 1, selected: null, expanded: null };
    readHash();
    render();
  });
})();
