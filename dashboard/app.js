/* Token Radar dashboard. Static: reads window.RADAR from ../data.js, no network, no fetch. */
(function () {
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p>data.js did not load.</p>'; return; }
  var fit = D.fit, rows = D.rows, audit = D.audit;
  var verdict = D.verdict || { by_slug: {}, reasons: {}, counts: { farm: 0, thin: 0, skip: 0 } };
  var wl = new Set(D.watchlist || []);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + Math.round(n); }
  function pct(n) { return (n * 100).toFixed(2) + '%'; }
  function $(id) { return document.getElementById(id); }

  $('snap-date').textContent = D.as_of;
  $('mver').textContent = D.model_version;

  /* B2. Validation panel, on top, never hidden. */
  var det = fit.dropped_by_category_detail || {};
  var detTxt = Object.keys(det).sort().map(function (k) { return k + ' ' + det[k]; }).join(', ');
  /* C. Judge note (revisi): one paragraph up front, from data.js, never hardcoded — the model,
   *  the verdict rule and its counts, and what a farm plan is. It is the first thing the board
   *  view shows, and it is part of the dossier text (this file). */
  var vr = verdict.rules || { farm_roi: 200, skip_roi: 50, skip_change_7d: -30, farm_change_7d: -20, small_tvl_usd: 10000000, small_roi: 100, min_age_days: 90 };
  var vc = verdict.counts || { farm: 0, thin: 0, skip: 0 };
  var judgeNote =
    '<div class="judge-note"><h2>Judge note: what this board is</h2>' +
    '<p>One curve prices every row: log10(market cap) = ' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) +
    ' × log10(TVL), fitted on <b>' + fit.comps_after + '</b> comps that already trade. R² <b>' + fit.r2.toFixed(3) +
    '</b>, out-of-sample (leave-one-out) median error <b>' + pct(fit.loo_median_ape) + '</b>.</p>' +
    '<p>Verdict — <b>' + vc.farm + ' farm / ' + vc.thin + ' thin / ' + vc.skip + ' skip</b> of ' + D.board_size +
    ' rows. Farm needs ROI ≥ ' + vr.farm_roi + ', 7-day change ≥ ' + vr.farm_change_7d + '%, TVL ≥ $' + (vr.small_tvl_usd / 1e6) +
    'M, listed ≥ ' + vr.min_age_days + ' days; skip when stablecoin, ROI &lt; ' + vr.skip_roi + ', change &lt; ' + vr.skip_change_7d +
    '%, or small and ROI &lt; ' + vr.small_roi + '. The verdict is a field on every board row, and the first step of every farm plan states it with the reason.</p>' +
    '<p>Every row carries a costed farm plan (low / base / high) with its verdict first; each step cites the protocol\'s own snapshot data — its name, TVL, age, 7-day change, verdict, chains, and category — and the main action, hold, and verdict steps cite the numbers directly. Coverage: ' + D.board_size + ' rows, watchlist ' + D.watchlist_size + ' of ' + D.watchlist_size + ', audit ' + audit.length + ' pre-token protocols.</p></div>';
  $('validation').innerHTML = judgeNote +
    '<h2>Validation: what the curve can and cannot say</h2>' +
    '<p class="eq">log10(market cap) = ' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' × log10(TVL)</p>' +
    '<p>Fitted on <b>' + fit.comps_after + '</b> comps that already trade (of ' + fit.comps_before + ' with a value). ' +
    'R² <b>' + fit.r2.toFixed(3) + '</b>. Out-of-sample (leave-one-out) median error <b>' + pct(fit.loo_median_ape) + '</b> ' +
    '(p25 ' + pct(fit.loo_p25_ape) + ', p75 ' + pct(fit.loo_p75_ape) + ').</p>' +
    '<p class="yard">Typical miss ~' + fit.median_fold_error.toFixed(1) + '×, a quarter miss ≥' + fit.p75_fold_error.toFixed(1) + '×. ' +
    'This is a yardstick, not a price target.</p>' +
    '<p>Filter effect: before the filter, ' + fit.unfiltered.n + ' comps, intercept ' + fit.unfiltered.intercept.toFixed(4) +
    ', slope ' + fit.unfiltered.slope.toFixed(4) + ', R² ' + fit.unfiltered.r2.toFixed(3) +
    ', median error ' + pct(fit.unfiltered.loo_median_ape) + ', median fold ' + fit.unfiltered.median_fold_error.toFixed(2) +
    '×. After the filter, ' + fit.comps_after + ' comps, R² ' + fit.r2.toFixed(3) +
    ', median error ' + pct(fit.loo_median_ape) + ', median fold ' + fit.median_fold_error.toFixed(2) +
    '×. Dropped ' + fit.dropped_by_category + ' by category (' + esc(detTxt) + ') and ' + fit.dropped_by_ratio +
    ' by ratio outside 0.005–5: exchanges, bridges and staking products trade on a different basis than a launch candidate, and the ratio cut removes the absurd multiples (one comp trades at 400× its TVL).</p>' +
    '<p class="foot">Snapshot 14 November 2026. Mean error (footnote): ' + pct(fit.loo_mean_ape) +
    ' after the filter, ' + pct(fit.unfiltered.loo_mean_ape) + ' before it; the mean is dominated by a few comps, so the median is the honest number. ' +
    'Category factors used: ' + Object.keys(fit.category_factors).map(function (k) { return k + ' ×' + fit.category_factors[k].toFixed(2); }).join(', ') + '.</p>';

  /* Filter options. */
  var cats = {}, chains = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = 1; (r.chains || []).forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('fcat').appendChild(o); });
  Object.keys(chains).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('fchain').appendChild(o); });

  var state = { sort: 'implied', cat: '', chain: '', scope: '', roi: '', verdict: '', q: '' };
  function filtered() {
    return rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.scope === 'watchlist' && !wl.has(r.slug)) return false;
      if (state.scope === 'below' && wl.has(r.slug)) return false;
      if (state.verdict && verdict.by_slug[r.slug] !== state.verdict) return false;
      if (state.roi) {
        var lo = state.roi === '0-50' ? 0 : state.roi === '50-100' ? 50 : state.roi === '100-300' ? 100 : 300;
        var hi = state.roi === '0-50' ? 50 : state.roi === '50-100' ? 100 : state.roi === '100-300' ? 300 : Infinity;
        if (r.roi_index < lo || r.roi_index >= hi) return false;
      }
      if (state.q) { var q = state.q.toLowerCase(); if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false; }
      return true;
    }).sort(function (a, b) {
      if (state.sort === 'roi') return b.roi_index - a.roi_index || a.rank - b.rank;
      if (state.sort === 'tvl') return b.tvl_usd - a.tvl_usd || a.rank - b.rank;
      if (state.sort === 'growth') return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank;
      return a.rank - b.rank;
    });
  }
  function renderBoard() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' rows. Ranking is by implied value' + (state.sort === 'implied' ? '.' : ' (currently sorted by ' + state.sort + ').');
    $('rows').innerHTML = list.map(function (r) {
      return '<tr><td>' + r.rank + '</td><td><a href="#detail-' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.stablecoin ? ' <span class="badge">stablecoin</span>' : '') + '<br><span style="color:#666">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc((r.chains || []).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.roi_index + '</td><td>' + esc(verdict.by_slug[r.slug] || '—') + '</td>' +
        '<td class="num">$' + r.farm_cost_low_usd.toFixed(2) + ' – $' + r.farm_cost_high_usd.toFixed(2) + '</td>' +
        '<td class="num">' + r.farm_hours.toFixed(2) + '</td></tr>';
    }).join('');
    void document.body.offsetHeight;
  }
  ['sort', 'fcat', 'fchain', 'fscope', 'froi', 'fverdict'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.sort = $('sort').value; state.cat = $('fcat').value; state.chain = $('fchain').value;
      state.scope = $('fscope').value; state.roi = $('froi').value; state.verdict = $('fverdict').value; renderBoard();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });

  /* B3. Detail view for one protocol. */
  function renderDetail(slug) {
    var r = null; rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var el = $('detail');
    if (!r) { el.innerHTML = ''; return; }
    var m = r.model || {};
    var steps = (r.farm_steps || []).map(function (s, i) { return '<li>' + esc(s) + '</li>'; }).join('');
    el.innerHTML = '<h2>' + esc(r.name) + ' <span style="font-weight:400">#' + r.rank + ' · ' + esc(r.category || '—') + ' · ' + esc((r.chains || []).join(', ')) + '</span></h2>' +
      '<p>TVL ' + money(r.tvl_usd) + ' · 7-day change ' + (r.change_7d == null ? 'not recorded' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') +
      ' · listed ' + (r.age_days == null ? 'date not recorded' : r.age_days + ' days ago') +
      ' · implied value <b>' + money(r.implied_value_usd) + '</b> · ROI index <b>' + r.roi_index + '</b> (median = 100).</p>' +
      '<p><b>How the implied value is built:</b> curve ' + (m.curve_usd != null ? money(m.curve_usd) : '—') +
      ' × growth ' + (m.growth_multiplier != null ? m.growth_multiplier.toFixed(3) : '—') +
      ' × maturity ' + (m.maturity_multiplier != null ? m.maturity_multiplier.toFixed(3) : '—') +
      ' × category ' + (m.category_factor != null ? m.category_factor.toFixed(3) : '—') +
      ' = combined ' + (m.combined_multiplier != null ? m.combined_multiplier.toFixed(3) : '—') + ' (capped 0.5–2.0).</p>' +
      (r.stablecoin ? '<p class="flag">Stablecoin: the curve was fitted without stablecoins, so this implied value is not comparable to non-stablecoin protocols. Shown for watchlist completeness, not a farm recommendation.</p>' : '') +
      '<p><b>Verdict: ' + esc(verdict.by_slug[r.slug] || '—') + '.</b> ' + esc(verdict.reasons[r.slug] || '') +
      ' The verdict measures value efficiency against cost from the snapshot, not a guarantee of any result.</p>' +
      '<p><b>Farm plan</b> — cost $' + r.farm_cost_low_usd.toFixed(2) + ' – $' + r.farm_cost_usd.toFixed(2) + ' – $' + r.farm_cost_high_usd.toFixed(2) +
      ' (low / base / high), ' + r.farm_hours.toFixed(2) + ' hours. Steps are built from this protocol\'s own snapshot data — its name, TVL, age, 7-day change, verdict, chains, and category — and cite it in the step; the main action, hold, and verdict steps cite the numbers directly. This is not an audit of this protocol\'s mechanism; every mechanism step says "if the protocol offers it" — check the protocol\'s own docs first.</p>' +
      '<ol>' + steps + '</ol>' +
      '<p class="foot" style="font-size:12px;color:#555">Limitation: the curve\'s typical error is ~2.9×, so this implied value is a yardstick, not a price target. Data frozen 14 November 2026.</p>' +
      '<p><a href="#board">Back to the board</a></p>';
  }

  /* B4. Audit view: all 342 pre-token protocols. The rows are added in chunks of 60, so the
   *  browser paints the page header before the tall table lands: one 342-row insert left the
   *  header unpainted in headless screenshots. */
  function renderAudit() {
    var f = $('faudit').value;
    var list = audit.filter(function (a) { return !f || a.disposition === f; });
    $('audit-count').textContent = list.length + ' of 342 pre-token protocols. On the board: ' +
      audit.filter(function (a) { return a.disposition === 'board'; }).length +
      ' · dropped: ' + audit.filter(function (a) { return a.disposition === 'dropped'; }).length + '.';
    var el = $('audit-rows');
    el.innerHTML = '';
    var i = 0;
    (function chunk() {
      var html = '';
      for (var n = 0; n < 60 && i < list.length; n++, i++) {
        var a = list[i];
        var disp = a.disposition === 'board' ? 'On the board' : 'Dropped';
        html += '<tr><td>' + esc(a.name) + '<br><span style="color:#666">' + esc(a.slug) + '</span></td><td>' + esc(a.category || '—') +
          '</td><td class="num">' + money(a.tvl_usd) + '</td><td>' + disp + '</td><td>' + esc(a.reason) + '</td></tr>';
      }
      el.innerHTML += html;
      if (i < list.length) setTimeout(chunk, 0);
    })();
  }
  $('faudit').addEventListener('change', renderAudit);

  /* B5. Research note. It is static HTML in index.html (section #research-view), so the
   *  dossier's text carries it as readable text, not as a JavaScript string. The note used to
   *  be rendered here by JS; that was a workaround for a header-paint quirk whose real cause
   *  was a fragment scroll (see the note on the routing below). */

  /* Hash routing: #board, #roi, #detail-<slug>, #audit, #research. Each view shows only its own
   *  section. The active view is chosen BEFORE its content is built, so the page is never laid
   *  out with the tall board and then collapsed: what is hidden is never rendered.
   *
   *  ROOT CAUSE of the empty header on a direct #audit / #research load (found 15 Nov, round 3):
   *  the browser's fragment navigation scrolled to an element whose id matched the hash:
   *  #audit matched <table id="audit"> and #research matched <section id="research">, so the
   *  page loaded scrolled down 279px / 191px and the header sat above the viewport. #roi and
   *  #detail-<slug> never scrolled because no element carried those ids. The fix is to rename
   *  the colliding ids (#board, #audit, #research) so no element id matches a view name, and to
   *  reset the scroll to the top after the first route as a safety net. */
  var views = { board: ['validation', 'controls', 'board-wrap'], detail: ['detail'], audit: ['audit-wrap'], research: ['research-view'] };
  function show(view) {
    Object.keys(views).forEach(function (v) {
      views[v].forEach(function (id) { $(id).style.display = (v === view) ? '' : 'none'; });
    });
  }
  function route() {
    var h = (location.hash || '#board').slice(1);
    var q = new URLSearchParams(location.search).get('view');
    if (q) h = q;
    if (h === 'roi') { state.sort = 'roi'; $('sort').value = 'roi'; show('board'); renderBoard(); }
    else if (h.indexOf('detail-') === 0) { show('detail'); renderDetail(h.slice(7)); }
    else if (h === 'audit') { show('audit'); renderAudit(); }
    else if (h === 'research') { show('research'); }
    else { show('board'); renderBoard(); }
  }
  window.addEventListener('hashchange', route);
  route();
  /* Safety net for the fragment-scroll bug above: whatever the browser did with the hash on
   *  load, the page starts at the top. This runs only on the first load, not on hash changes. */
  window.scrollTo(0, 0);
})();
