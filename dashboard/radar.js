// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, its filters, a per-protocol detail drawer with the model's own
// arithmetic and the protocol's farm plan, the live-token set kept apart, and a sandbox that
// re-runs the model with the reader's own constants. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    sandbox: { base: null, growth: null, maturity: null }
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
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

  // The model in one function, the same arithmetic lib/model.ts scores with: the page recomputes
  // a row from the snapshot figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same model. The sandbox calls it with changed constants.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var breadth = 1 + Math.min(Math.max(chains - 1, 0), model.breadth_max_chains) * model.breadth_step;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }
  function sandboxModel() {
    var m = DATA.model, s = state.sandbox;
    if (s.base === null && s.growth === null && s.maturity === null) return null;
    return {
      base_multiple: s.base === null ? m.base_multiple : s.base,
      growth_weight: s.growth === null ? m.growth_weight : s.growth,
      growth_floor: m.growth_floor, growth_cap: m.growth_cap,
      maturity_floor: s.maturity === null ? m.maturity_floor : s.maturity,
      maturity_range: m.maturity_range, maturity_days: m.maturity_days,
      breadth_step: m.breadth_step, breadth_max_chains: m.breadth_max_chains,
      unknown_age_days: m.unknown_age_days
    };
  }
  // Sandbox ranks: every row re-scored under the sandbox model, strongest first.
  function sandboxRanks() {
    var model = sandboxModel();
    if (!model) return null;
    var scored = DATA.rows.map(function (r) { return { slug: r.slug, implied: impliedOf(r, model) }; });
    scored.sort(function (a, b) { return b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    var out = {};
    scored.forEach(function (s, i) { out[s.slug] = { rank: i + 1, implied: s.implied }; });
    return out;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + n + ' on ' + chain + ' as a lender, then borrow a small amount against it to register both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('yield') >= 0 || c === 'farm') return 'Provide $' + capital + ' of liquidity to ' + n + "'s deepest pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + n + ', then use the bridged funds in its own app so the volume is yours.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + n + ' on ' + chain + ' and hold the receipt token it issues.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + n + ' on ' + chain + ' and open one small hedged position, then close it after a day.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + n + ' and place one market position on ' + chain + ', then let it settle.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + n + ' vault on ' + chain + ' and hold the vault shares for the full qualifying window.';
    if (c.indexOf('stablecoin') >= 0 || c.indexOf('algo-stables') >= 0) return 'Mint or hold $' + capital + ' of the stable asset ' + n + ' issues on ' + chain + ' and keep it in your wallet.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of " + n + "'s yield-bearing asset on " + chain + ' and hold it in your wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + n + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('launchpad') >= 0) return 'Stake or hold $' + capital + ' through ' + n + "'s launchpad on " + chain + ' and join one sale allocation.';
    if (c.indexOf('nft') >= 0) return 'List or buy one item worth about $' + capital + ' on ' + n + ' on ' + chain + ' and keep the trade receipt.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Move $' + capital + ' through ' + n + ' on ' + chain + ' as a payment and keep the receipt.';
    if (c.indexOf('locker') >= 0) return 'Lock $' + capital + ' of tokens in ' + n + "'s locker on " + chain + ' for the shortest term it offers.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + n + "'s incentive pool on " + chain + ' and cast one vote.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + " of " + n + "'s index token on " + chain + ' and hold it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + n + "'s chain and use one of its native apps for a week.";
    if (c.indexOf('privacy') >= 0 || c.indexOf('ai') >= 0) return 'Run $' + capital + ' through ' + n + ' on ' + chain + ' and use its main feature at least once a week.';
    if (c.indexOf('otc') >= 0) return 'Complete one $' + capital + ' trade on ' + n + "'s marketplace on " + chain + '.';
    if (c.indexOf('reserve') >= 0 || c === 'dor') return 'Hold $' + capital + " of " + n + "'s reserve asset on " + chain + ' in your wallet.';
    return 'Deposit $' + capital + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open.';
  }
  function farmPlan(p) {
    var chain = p.chains && p.chains.length ? p.chains[0] : 'its main chain';
    var capital = p.capital_usd, gas = p.gas_usd, hold = p.hold_days;
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about $' + gas + ' gas', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' capital + ~$' + gas + ' gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so your wallet stays active.', cost: 'about $' + gas + ' gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' }
    ];
    if (p.chains && p.chains.length > 1) {
      steps.push({ text: 'Repeat a smaller position on ' + p.chains[1] + ', the protocol\'s second chain, so your activity is counted on two networks.', cost: '$' + Math.round(capital / 2) + ' more capital + ~$' + gas + ' gas', time: '15 minutes' });
    }
    steps.push(
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check; never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind half the position first and check the exit works.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('min', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list, sb) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'farm') { av = a.capital_usd; bv = b.capital_usd; }
      else if (sb) { av = sb[a.slug].implied; bv = sb[b.slug].implied; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Token ', el('em', { text: 'Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
        el('span', { text: DATA.board_size + ' rows scored' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Pre-token protocol radar' }),
        el('h1', { text: 'Which protocol is worth farming before its token exists?' }),
        el('p', null, 'Every protocol on the snapshot\u2019s watchlist — ',
          el('b', { text: DATA.watchlist_size + ' with $' + Math.round(DATA.floor_usd / 1e6) + 'M+ of TVL and no token on record' }),
          ' — ranked by the implied value of the token it may one day issue, plus ',
          el('b', { text: DATA.early_size + ' early protocols' }),
          ' below the floor the radar caught first. Select any row for its model and its farm plan.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact hot' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_size + ' / ' + DATA.watchlist_size, el('small', { text: ' 100%' }))),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median row' }), el('b', { text: fmtUsd(DATA.median_implied_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topChains() {
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); }).slice(0, 24);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = topChains();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var minSel = el('select', { id: 'min', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [5e7, '$50M+ TVL'], [1e8, '$100M+ TVL'], [5e8, '$500M+ TVL'], [1e9, '$1B+ TVL']].map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null });
      })
    );
    minSel.addEventListener('change', function () { state.minTvl = Number(minSel.value); writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label,
        onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var countText = state.tab === 'live' ? DATA.live.length + ' live-token protocols' : filteredRows().length + ' rows shown';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'min', text: 'Size' }), minSel),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'View' }),
        el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('sandbox', 'Model sandbox'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable(sb) {
    var list = sortedRows(filteredRows(), sb);
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or size to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, sb ? sb[r.slug].implied : r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var shownRank = sb ? sb[r.slug].rank : r.rank;
      var shownImplied = sb ? sb[r.slug].implied : r.implied_value_usd;
      var delta = null;
      if (sb) {
        var d = r.rank - sb[r.slug].rank;
        delta = el('span', { class: 'delta ' + (d > 0 ? 'pos' : d < 0 ? 'neg' : ''), text: d === 0 ? ' = ' : (d > 0 ? ' \u25b2' + d : ' \u25bc' + (-d)) });
      }
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rankcell' + (shownRank <= 3 ? ' top3' : ''), text: '#' + shownRank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: '$' + r.capital_usd }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((shownImplied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(shownImplied) }),
          delta
        )),
        el('td', null, el('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('farm', 'Farm cost'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Radar' })
          )),
          tbody,
          el('caption', { text: sb
            ? 'Sandbox ranking: the same rows re-scored with your constants. The delta shows each move against the board rank.'
            : 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' })
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', null, el('span', { class: 'badge live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'MCap / TVL' }))),
          tbody,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — but their MCap / TVL ratios are the market\u2019s own hint at what a launch is worth.' })
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', null, 'How implied value is computed ', el('span', { class: 'tag', text: DATA.model_version })),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × ', el('b', { text: String(m.base_multiple) }),
        ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ', el('b', { text: String(m.growth_weight) }),
        ') × (', el('b', { text: String(m.maturity_floor) }), ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range,
        ') × (1 + min(chains − 1, ' + m.breadth_max_chains + ') × ', el('b', { text: String(m.breadth_step) }), ') )'
      ),
      el('div', { class: 'factors' },
        el('div', { class: 'factor' }, el('b', { text: 'TVL base' }), el('span', { text: 'A launch is priced off the value already locked in the protocol: 30% of TVL.' })),
        el('div', { class: 'factor' }, el('b', { text: '7-day growth' }), el('span', { text: 'A hot week lifts value, a cold one cuts it; clamped so one spike cannot dominate.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Maturity' }), el('span', { text: 'Days listed with no token, to three years: a protocol that survived is a steadier launch.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Chain breadth' }), el('span', { text: 'Each extra chain adds 2%, to 12%: a wider footprint reaches more farmers.' }))
      ),
      el('p', { class: 'sub', text: 'Age is the time from listed_at to the snapshot date, ' + DATA.as_of + '; an unlisted age reads as ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, ranked by this same number. Try your own constants in the Model sandbox tab — the board re-ranks live.' })
    );
  }

  function sandboxPanel() {
    var m = DATA.model, s = state.sandbox;
    function slider(key, label, min, max, step, base, hint) {
      var out = el('output', { text: (s[key] === null ? base : s[key]).toFixed(2) });
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(s[key] === null ? base : s[key]), 'aria-label': label });
      // While dragging, move only the readout: re-rendering mid-drag would replace the slider
      // under the pointer. The board re-ranks when the slider is released.
      input.addEventListener('input', function () { out.textContent = Number(input.value).toFixed(2); });
      input.addEventListener('change', function () {
        var v = Number(input.value);
        state.sandbox[key] = v === base ? null : v;
        render();
      });
      return el('div', { class: 'slider' }, el('label', null, label, out), input, el('span', { text: hint }));
    }
    var active = sandboxModel() !== null;
    var movers = '';
    if (active) {
      var sb = sandboxRanks();
      var moved = DATA.rows.map(function (r) { return { r: r, d: r.rank - sb[r.slug].rank }; })
        .filter(function (x) { return x.d !== 0; })
        .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 3);
      movers = moved.length
        ? ' Biggest movers: ' + moved.map(function (x) { return x.r.name + ' ' + (x.d > 0 ? 'up ' : 'down ') + Math.abs(x.d) + ' to #' + sb[x.r.slug].rank; }).join('; ') + '.'
        : ' No rank changes under these constants.';
    }
    return el('section', { class: 'panel model' },
      el('h2', null, 'Model sandbox ', el('span', { class: 'tag', text: active ? 'live — board re-ranked below' : 'drag a slider to re-rank the board' })),
      el('div', { class: 'sandbox' },
        slider('base', 'TVL multiple', 0.05, 1, 0.05, m.base_multiple, 'What share of TVL a launch is worth. Base: ' + m.base_multiple + '.'),
        slider('growth', 'Growth weight', 0, 1, 0.05, m.growth_weight, 'How much a hot or cold week moves value. Base: ' + m.growth_weight + '.'),
        slider('maturity', 'Maturity floor', 0.3, 1, 0.05, m.maturity_floor, 'The value a brand-new protocol keeps before age adds more. Base: ' + m.maturity_floor + '.')
      ),
      el('p', { class: 'sandbox-note' },
        active ? el('b', { text: 'Sandbox active.' }) : 'The board below still shows the published ranking. ',
        active ? ' The table re-scores every row with your constants and shows each rank move.' + movers : ' Move any slider and the board re-ranks live, with each row\u2019s move against its published rank.',
        active ? el('span', null, ' ', el('button', { class: 'linklike', type: 'button', text: 'Reset to the published model', onclick: function () { state.sandbox = { base: null, growth: null, maturity: null }; render(); } })) : null
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function whyLine(row) {
    var parts = [];
    parts.push('TVL ' + fmtUsd(row.tvl_usd) + ' gives a base of ' + fmtUsd(row.base_usd));
    parts.push(row.change_7d === null ? 'no 7-day change was reported' : '7-day change ' + fmtPct(row.change_7d) + ' multiplies it by ' + row.growth_multiplier);
    parts.push(row.age_days === null ? 'its age is unlisted, so the model reads 365 days' : 'age ' + fmtAge(row.age_days) + ' multiplies it by ' + row.maturity_multiplier);
    parts.push((row.chains ? row.chains.length : 0) + ' chain' + ((row.chains ? row.chains.length : 0) === 1 ? '' : 's') + ' multiplies it by ' + row.breadth_multiplier);
    return 'Ranked #' + row.rank + ' because ' + parts.join('; ') + ', for an implied value of ' + fmtUsd(row.implied_value_usd) + '.';
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmPlan(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge ' + (row.on_watchlist ? 'watch' : 'early'), text: (row.on_watchlist ? 'Watchlist · ' : 'Early radar · ') + 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'detail-section' },
      el('h3', { text: 'Why this rank' }),
      el('p', { class: 'why' }, whyLine(row))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, factor by factor' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base: TVL × ' + DATA.model.base_multiple }), el('b', { class: 'num', text: fmtUsd(row.base_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth (' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: '× ' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token (' + fmtAge(row.age_days) + ')' }), el('b', { class: 'num', text: '× ' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chain breadth (' + (row.chains ? row.chains.length : 0) + ' chains)' }), el('b', { class: 'num', text: '× ' + row.breadth_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'verify' }, 'Model ' + DATA.model_version + ': this page recomputes the row as ' + fmtUsd(recomputed) + ' — ',
        recomputed === row.implied_value_usd ? el('b', { text: 'the same number board.json carries.' }) : 'which differs from the board: the data would be stale.',
        ' An estimate, not a price.')
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — about $' + (row.capital_usd + row.gas_usd * 2) + ' to start, ' + row.hold_days + ' days to hold' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('b', { text: s.text }),
          el('span', { class: 'chips' },
            el('span', { class: 'chip cost', text: 'Cost: ' + s.cost }),
            el('span', { class: 'chip', text: 'Time: ' + s.time })));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', null, el('b', { text: 'Read this before you farm. ' }),
        'Implied value is this entry\u2019s own claim, never make.fun\u2019s, and it is not a prediction that a token will be issued or when. ',
        'A protocol here \u201Crecords no token\u201D: DefiLlama\u2019s record is not proof it has none. ',
        'Snapshot ', DATA.as_of, ' · ', DATA.source, '. Farm with money you can lose; never pay anyone to claim an airdrop.')
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'sandbox') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(boardTable(sandboxRanks()));
    } else {
      shell.appendChild(boardTable(null));
      shell.appendChild(modelPanel());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && !dialog.open) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
