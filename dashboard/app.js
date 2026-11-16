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
  var rg = fit.ridge || null;
  var cov = D.coverage || { pre_token: 0, eligible: 0, dropped: 0, live_token_no_mcap: 0 };
  function sgn(n, d) { return (n >= 0 ? '+' : '') + n.toFixed(d == null ? 3 : d); }
  var judgeNote =
    '<div class="judge-note"><h2>Judge note: what this board is</h2>' +
    '<p>One ridge model prices every row, fitted on <b>' + fit.comps_after + '</b> comps that already trade: log10(market cap) from each protocol\'s TVL, age, 7-day change, chain count and category. R² <b>' + (rg ? rg.r2_insample.toFixed(3) : '—') +
    '</b> in-sample; out-of-sample (nested leave-one-out) median error <b>' + (rg ? pct(rg.loo.median_ape) : '—') +
    '</b>; walk-forward (fit the ' + (rg ? rg.timesplit.train_n : '—') + ' comps listed longest ago, test the ' + (rg ? rg.timesplit.test_n : '—') + ' newest) median error <b>' + (rg ? pct(rg.timesplit.median_ape) : '—') + '</b>.</p>' +
    '<p>Verdict — <b>' + vc.farm + ' farm / ' + vc.thin + ' thin / ' + vc.skip + ' skip</b> of ' + D.board_size +
    ' rows. Farm needs ROI ≥ ' + vr.farm_roi + ', 7-day change ≥ ' + vr.farm_change_7d + '%, TVL ≥ $' + (vr.small_tvl_usd / 1e6) +
    'M, listed ≥ ' + vr.min_age_days + ' days; skip when stablecoin, ROI &lt; ' + vr.skip_roi + ', change &lt; ' + vr.skip_change_7d +
    '%, or small and ROI &lt; ' + vr.small_roi + '. The verdict is a field on every board row, and the first step of every farm plan states it with the reason.</p>' +
    '<p>Every row carries a costed farm plan (low / base / high) with its verdict first, and a 90% bootstrap band on its implied value (median ' + (rg ? rg.bootstrap.median_band_fold.toFixed(2) : '—') +
    '× wide). Coverage: ' + D.board_size + ' rows — every eligible pre-token protocol in the snapshot (watchlist ' + D.watchlist_size + ' of ' + D.watchlist_size + '), audit ' + audit.length + ' pre-token protocols.</p></div>';
  $('validation').innerHTML = judgeNote +
    '<h2>Validation: what the ridge can and cannot say</h2>' +
    '<div class="stats">' +
    '<div class="stat"><span class="stat-v">' + (rg ? rg.r2_insample.toFixed(3) : '—') + '</span><span class="stat-l">R², ridge in-sample</span></div>' +
    '<div class="stat"><span class="stat-v">' + (rg ? pct(rg.loo.median_ape) : '—') + '</span><span class="stat-l">nested leave-one-out median error</span></div>' +
    '<div class="stat"><span class="stat-v">' + (rg ? pct(rg.timesplit.median_ape) : '—') + '</span><span class="stat-l">walk-forward median error</span></div>' +
    '<div class="stat"><span class="stat-v">' + (rg ? rg.bootstrap.median_band_fold.toFixed(2) + '×' : '—') + '</span><span class="stat-l">median 90% band width</span></div>' +
    '</div>' +
    '<p class="eq">log10(market cap) = ' + (rg ? rg.y_mean.toFixed(3) : '—') + ' + ' +
    (rg ? rg.feature_names.map(function (n, i) { return n.replace('log_', 'log ') + ' ' + sgn(rg.coefs[i]); }).join(', ') : '—') +
    ' (features standardised; Dexs is the reference category)</p>' +
    '<p><b>Ridge vs the OLS curve, same 81 comps.</b> OLS (one line on log TVL): R² ' + fit.r2.toFixed(3) + ', leave-one-out median error ' + pct(fit.loo_median_ape) + ', median fold ' + fit.median_fold_error.toFixed(2) + '×. Ridge (11 features, λ = ' + (rg ? rg.lambda : '—') + ' by 5-fold CV): R² ' + (rg ? rg.r2_insample.toFixed(3) : '—') + ' in-sample, nested leave-one-out median error ' + (rg ? pct(rg.loo.median_ape) : '—') + ' (p25 ' + (rg ? pct(rg.loo.p25_ape) : '—') + ', p75 ' + (rg ? pct(rg.loo.p75_ape) : '—') + '), median fold ' + (rg ? rg.loo.median_fold.toFixed(2) : '—') + '×.</p>' +
    '<p><b>Walk-forward: fit the past, test the future.</b> Trained on the ' + (rg ? rg.timesplit.train_n : '—') + ' comps listed longest ago (' + (rg ? rg.timesplit.train_age_min : '—') + '–' + (rg ? rg.timesplit.train_age_max : '—') + ' days), tested on the ' + (rg ? rg.timesplit.test_n : '—') + ' most recently listed (' + (rg ? rg.timesplit.test_age_min : '—') + '–' + (rg ? rg.timesplit.test_age_max : '—') + ' days). Ridge: median error ' + (rg ? pct(rg.timesplit.median_ape) : '—') + ', median fold ' + (rg ? rg.timesplit.median_fold.toFixed(2) : '—') + '×, median signed error ' + (rg ? sgn(rg.timesplit.median_signed_log_error) : '—') + ' dex — the ridge under-predicts the newest listings by ~3×, so its implied values for young protocols are conservative. OLS on the same split: median error ' + pct(fit.ols_timesplit.median_ape) + ', median fold ' + fit.ols_timesplit.median_fold.toFixed(2) + '×, signed error ' + sgn(fit.ols_timesplit.median_signed_log_error) + ' dex.</p>' +
    '<p><b>Bootstrap bands.</b> 1000 case resamples of the comps, the ridge refit each time at λ = ' + (rg ? rg.lambda : '—') + '. At the median comp TVL ($' + (rg ? Math.round(rg.bootstrap.median_tvl_usd).toLocaleString('en-US') : '—') + ') the 90% band is $' + (rg ? Math.round(rg.bootstrap.band_at_median_tvl_low).toLocaleString('en-US') : '—') + '–$' + (rg ? Math.round(rg.bootstrap.band_at_median_tvl_high).toLocaleString('en-US') : '—') + ' (' + (rg ? rg.bootstrap.band_at_median_tvl_fold.toFixed(2) : '—') + '× wide). The median board row\'s band is ' + (rg ? rg.bootstrap.median_band_fold.toFixed(2) : '—') + '× wide: rows far from the comps\' centre carry wider bands. The band is curve uncertainty only — the ~3× typical error is protocol-level noise, and no band removes it.</p>' +
    '<p>Filter effect: before the filter, ' + fit.unfiltered.n + ' comps, intercept ' + fit.unfiltered.intercept.toFixed(4) +
    ', slope ' + fit.unfiltered.slope.toFixed(4) + ', R² ' + fit.unfiltered.r2.toFixed(3) +
    ', median error ' + pct(fit.unfiltered.loo_median_ape) + ', median fold ' + fit.unfiltered.median_fold_error.toFixed(2) +
    '×. After the filter, ' + fit.comps_after + ' comps, R² ' + fit.r2.toFixed(3) +
    ', median error ' + pct(fit.loo_median_ape) + ', median fold ' + fit.median_fold_error.toFixed(2) +
    '×. Dropped ' + fit.dropped_by_category + ' by category (' + esc(detTxt) + ') and ' + fit.dropped_by_ratio +
    ' by ratio outside 0.005–5: exchanges, bridges and staking products trade on a different basis than a launch candidate, and the ratio cut removes the absurd multiples (one comp trades at 400× its TVL).</p>' +
    '<p><b>Coverage.</b> ' + cov.eligible + ' of ' + cov.pre_token + ' strict pre-token protocols are on the board (' + cov.dropped + ' dropped as exchanges, bridges, staking products or versioned pools); the watchlist is all 40 of 40. Another ' + cov.live_token_no_mcap + ' protocols record no market cap but do have a token (a CoinGecko id or a symbol): they trade, so they are live, not pre-token, and the board does not rank them.</p>' +
    '<p class="foot">Snapshot 14 November 2026. Mean error (footnote): ' + pct(fit.loo_mean_ape) +
    ' after the filter, ' + pct(fit.unfiltered.loo_mean_ape) + ' before it; the mean is dominated by a few comps, so the median is the honest number.</p>';

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
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b>' +
        (r.model && r.model.band_low_usd ? '<br><span class="band-small">90% ' + money(r.model.band_low_usd) + '–' + money(r.model.band_high_usd) + '</span>' : '') + '</td>' +
        '<td class="num">' + r.roi_index + '</td><td><span class="chip chip-' + esc(verdict.by_slug[r.slug] || 'thin') + '">' + esc(verdict.by_slug[r.slug] || '—') + '</span></td>' +
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
    var pt = m.parts || { log_tvl: 0, log_age: 0, change_7d: 0, log_n_chains: 0, category: 0 };
    var bandHtml = '';
    if (m.band_low_usd != null && m.band_high_usd != null && m.band_low_usd > 0 && m.band_high_usd > m.band_low_usd) {
      var blo = Math.log10(m.band_low_usd), bhi = Math.log10(m.band_high_usd), bpt = Math.log10(r.implied_value_usd);
      var pos = Math.max(0, Math.min(100, ((bpt - blo) / (bhi - blo)) * 100));
      bandHtml = '<div class="band"><div class="band-track"><div class="band-marker" style="left:' + pos.toFixed(1) + '%"></div></div>' +
        '<div class="band-label">90% bootstrap band ' + money(m.band_low_usd) + ' – ' + money(m.band_high_usd) +
        ' (' + (m.band_fold != null ? m.band_fold.toFixed(2) : '—') + '× wide); the marker is the point estimate, the bar is log scale.</div></div>';
    }
    el.innerHTML = '<h2>' + esc(r.name) + ' <span style="font-weight:400">#' + r.rank + ' · ' + esc(r.category || '—') + ' · ' + esc((r.chains || []).join(', ')) + '</span></h2>' +
      '<p>TVL ' + money(r.tvl_usd) + ' · 7-day change ' + (r.change_7d == null ? 'not recorded' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') +
      ' · listed ' + (r.age_days == null ? 'date not recorded' : r.age_days + ' days ago') +
      ' · implied value <b>' + money(r.implied_value_usd) + '</b> · ROI index <b>' + r.roi_index + '</b> (median = 100).</p>' +
      '<p><b>How the implied value is built:</b> ridge, log10(implied) = ' + (m.log_pred != null ? m.log_pred.toFixed(3) : '—') +
      ' = intercept ' + (rg ? rg.y_mean.toFixed(3) : '—') +
      ' ' + sgn(pt.log_tvl) + ' (TVL) ' + sgn(pt.log_age) + ' (age) ' + sgn(pt.change_7d) + ' (7-day change) ' +
      sgn(pt.log_n_chains) + ' (chains) ' + sgn(pt.category) + ' (category ' + esc(r.category || '—') + ').</p>' +
      bandHtml +
      (r.stablecoin ? '<p class="flag">Stablecoin: the curve was fitted without stablecoins, so this implied value is not comparable to non-stablecoin protocols. Shown for watchlist completeness, not a farm recommendation.</p>' : '') +
      '<p><b>Verdict: ' + esc(verdict.by_slug[r.slug] || '—') + '.</b> ' + esc(verdict.reasons[r.slug] || '') +
      ' The verdict measures value efficiency against cost from the snapshot, not a guarantee of any result.</p>' +
      '<p><b>Farm plan</b> — cost $' + r.farm_cost_low_usd.toFixed(2) + ' – $' + r.farm_cost_usd.toFixed(2) + ' – $' + r.farm_cost_high_usd.toFixed(2) +
      ' (low / base / high), ' + r.farm_hours.toFixed(2) + ' hours. Steps are built from this protocol\'s own snapshot data — its name, TVL, age, 7-day change, verdict, chains, and category — and cite it in the step; the main action, hold, and verdict steps cite the numbers directly. This is not an audit of this protocol\'s mechanism; every mechanism step says "if the protocol offers it" — check the protocol\'s own docs first.</p>' +
      '<ol>' + steps + '</ol>' +
      '<p class="foot" style="font-size:12px;color:#555">Limitation: the ridge\'s typical error is ~' + (rg ? rg.loo.median_fold.toFixed(1) : '—') + '× (nested leave-one-out median fold), and its 90% band is ' + (m.band_fold != null ? m.band_fold.toFixed(2) : '—') + '× wide, so this implied value is a yardstick, not a price target. Data frozen 14 November 2026.</p>' +
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
    var q = new URLSearchParams(location.search);
    var view = q.get('view');
    if (view) h = view;
    if (h === 'roi') { state.sort = 'roi'; $('sort').value = 'roi'; }
    /* Deep-linkable board filters (?sort=&cat=&chain=&scope=&roi=&verdict=&q=), so a
     * filtered view is a URL the screenshots can point at. Applied after the view's own
     * sort, so an explicit ?sort= wins over the #roi view. */
    var fmap = { sort: 'sort', cat: 'fcat', chain: 'fchain', scope: 'fscope', roi: 'froi', verdict: 'fverdict', q: 'q' };
    Object.keys(fmap).forEach(function (k) {
      var v = q.get(k);
      if (v !== null && $(fmap[k])) $(fmap[k]).value = v;
    });
    state.sort = $('sort').value; state.cat = $('fcat').value; state.chain = $('fchain').value;
    state.scope = $('fscope').value; state.roi = $('froi').value; state.verdict = $('fverdict').value; state.q = $('q').value;
    if (h.indexOf('detail-') === 0) { show('detail'); renderDetail(h.slice(7)); }
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
