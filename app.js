/* Iowa Soil Ledger: loads the data files, runs model.js, and lays the cards out on a pannable, zoomable canvas. */
(function () {
  'use strict';

  var M = window.IowaModel;
  var D = {};                         // loaded data
  var settings = { tillage: 'reduced', trendId: 'plus05', LS: 1, scenarioId: 'background' };
  var view = { x: 0, y: 0, s: 1 };
  var cards = {};                     // id -> element
  var world = document.getElementById('world');
  var viewport = document.getElementById('viewport');
  var linksSvg = document.getElementById('links');

  // ---------- formatting ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x, d) { return x == null ? 'n/a' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function compact(x) {
    if (x == null) return 'n/a';
    var a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return (x / 1e3).toFixed(0) + 'K';
    return num(x);
  }
  function usd(x) { return x == null ? 'not reported' : '$' + compact(x); }
  var sourceIndex = {};
  function src(id) {
    if (!id || id === 'assumption') return ' <span class="pill assume" title="Model assumption. A sourced value is welcome as a pull request.">assumption</span>';
    var n = sourceIndex[id];
    return n ? '<sup class="src"><a href="#src-' + esc(id) + '" data-src="' + esc(id) + '">[' + n + ']</a></sup>' : '';
  }
  function cropColor(id) { return 'var(--' + ((D.model.crops[id] || {}).color || 'corn') + ')'; }

  // ---------- data ----------
  function get(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' returned ' + r.status);
      return path.slice(-4) === '.csv' ? r.text() : r.json();
    });
  }
  Promise.all(['data/crops.csv', 'data/farms.json', 'data/weather.json', 'data/lead.json', 'data/model.json', 'data/sources.json', 'data/site.json', 'data/feed.json', 'data/counties.csv'].map(get))
    .then(function (r) {
      D = { crops: M.parseCSV(r[0]), farms: r[1], weather: r[2], lead: r[3], model: r[4], sources: r[5], site: r[6], feed: r[7], counties: M.parseCSV(r[8]) };
      D.sources.filter(function (s) { return s.id !== 'assumption'; }).forEach(function (s, i) { sourceIndex[s.id] = i + 1; });
      settings.LS = D.model.erosion.LS.value;
      setupControls();
      build();
      document.getElementById('loading').hidden = true;
    })
    .catch(function (e) {
      document.getElementById('loading').textContent = 'The data files did not load (' + e.message + '). Serve this folder over http, for example with: npx serve .';
    });

  // ---------- controls ----------
  function setupControls() {
    var trend = document.getElementById('trend');
    trend.innerHTML = D.model.erosion.R_trend_options.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>'; }).join('');
    trend.value = settings.trendId;
    var scen = document.getElementById('scenario');
    scen.innerHTML = D.model.lead_inputs.scenarios.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>'; }).join('');
    scen.value = settings.scenarioId;
    var ls = document.getElementById('ls');
    ls.value = settings.LS;

    document.querySelectorAll('input[name=tillage]').forEach(function (r) {
      r.addEventListener('change', function () { settings.tillage = r.value; refresh(); });
    });
    trend.addEventListener('change', function () { settings.trendId = trend.value; refresh(); });
    scen.addEventListener('change', function () { settings.scenarioId = scen.value; refresh(); });
    ls.addEventListener('input', function () {
      settings.LS = Number(ls.value);
      document.getElementById('ls-out').textContent = settings.LS.toFixed(1);
      refresh();
    });
    var hud = document.getElementById('hud');
    var toggle = document.getElementById('hud-toggle');
    toggle.addEventListener('click', function () {
      var open = hud.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ---------- layout ----------
  // Columns of cards; each column stacks its cards top to bottom with a gap. Positions are world pixels.
  var COLUMNS = [
    { x: 0, w: 620, ids: ['hero', 'farms', 'model'] },
    { x: 720, w: 1160, ids: ['crops', 'statewide', 'contribute', 'sources'] },
    { x: 1980, w: 580, ids: ['weather', 'leadsoil', 'leadair', 'detonation'] },
    { x: 2660, w: 620, ids: ['hay', 'ethanol', 'counties'] }
  ];
  var GAP = 48;
  var JUMPS = [['hero', 'Overview'], ['crops', 'Crops'], ['statewide', 'Statewide'], ['weather', 'Weather'], ['leadsoil', 'Lead'], ['detonation', 'Detonation'], ['hay', 'Hay and cattle'], ['ethanol', 'Ethanol'], ['counties', 'Counties'], ['model', 'Model'], ['contribute', 'Contribute'], ['sources', 'Sources']];

  function makeCard(id, cls, w) {
    var el = document.createElement('section');
    el.className = 'card ' + (cls || '');
    el.id = 'card-' + id;
    el.style.width = w + 'px';
    world.appendChild(el);
    cards[id] = el;
    return el;
  }

  function build() {
    COLUMNS.forEach(function (col) {
      col.ids.forEach(function (id) { makeCard(id, id === 'crops' ? 'flat' : '', col.w); });
    });
    cards.hero.classList.add('hero');
    var jump = document.getElementById('jump');
    jump.innerHTML = JUMPS.map(function (j) { return '<button type="button" data-jump="' + j[0] + '">' + j[1] + '</button>'; }).join('');
    jump.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-jump]');
      if (b) flyTo(cards[b.dataset.jump], true);
    });
    world.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-src]');
      if (!a) return;
      e.preventDefault();
      var li = document.getElementById('src-' + a.dataset.src);
      document.querySelectorAll('.src-list li.hit').forEach(function (n) { n.classList.remove('hit'); n.style.background = ''; });
      if (li) { li.classList.add('hit'); li.style.background = 'color-mix(in srgb, var(--corn) 22%, transparent)'; }
      flyTo(cards.sources, true);
    });
    renderStatic();
    refresh();
    if (window.innerWidth < 760) flyTo(cards.hero, false); else fitAll(false);
    // Web fonts change card heights once they arrive, so restack when they do.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(stack);
  }

  function stack() {
    COLUMNS.forEach(function (col) {
      var y = 0;
      col.ids.forEach(function (id) {
        var el = cards[id];
        el.style.left = col.x + 'px';
        el.style.top = y + 'px';
        y += el.offsetHeight + GAP;
      });
    });
    drawLinks();
  }

  function box(id) {
    var el = cards[id];
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }

  function drawLinks() {
    var w = box('weather'), ls = box('leadsoil'), m = box('model'), c = box('crops');
    function curve(x1, y1, x2, y2) {
      var dx = (x2 - x1) / 2;
      return 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
    }
    var cx = c.x + c.w, cy1 = c.y + c.h * 0.3, cy2 = c.y + c.h * 0.7;
    linksSvg.innerHTML =
      '<path d="' + curve(w.x, w.y + 90, cx, cy1) + '"/>' +
      '<text x="' + (cx + 16) + '" y="' + (cy1 - 10) + '">rain sets R</text>' +
      '<path d="' + curve(ls.x, ls.y + 90, cx, cy2) + '"/>' +
      '<text x="' + (cx + 16) + '" y="' + (cy2 - 10) + '">lead in, lead out</text>' +
      '<path d="' + curve(m.x + m.w, m.y + 60, c.x, c.y + c.h * 0.5) + '"/>' +
      '<text x="' + (m.x + m.w + 14) + '" y="' + (m.y + 48) + '">A = R·K·LS·C·P</text>';
  }

  // ---------- static cards (do not depend on the scenario) ----------
  function renderStatic() {
    var f = D.farms, wx = D.weather, ld = D.lead;

    cards.farms.innerHTML =
      '<div class="eyebrow">Iowa farms, ' + f.year + src(f.source) + '</div>' +
      '<h2>' + num(f.operations) + ' farms working ' + compact(f.acres_operated) + ' acres</h2>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + num(f.acres_per_operation) + '</b><span>acres per farm</span></div>' +
        '<div class="stat"><b>' + compact(f.total_corn_planted_acres) + '</b><span>acres of corn planted</span></div>' +
        '<div class="stat"><b>' + usd(totalValue()) + '</b><span>crop value in the table below</span></div>' +
      '</div>' +
      '<ul class="rows">' + f.livestock.map(function (l) { return '<li><span>' + esc(l.name) + ' <span class="muted small">(' + esc(l.as_of) + ')</span></span><span>' + num(l.head) + '</span></li>'; }).join('') + '</ul>' +
      '<p class="small muted">Iowa farms also sold ' + usd(f.milk_value_usd) + ' of milk. Livestock matters for soil too: manure is one of the lead inputs in the model.</p>';

    var hr = wx.heavy_rain_days;
    cards.weather.innerHTML =
      '<div class="eyebrow">Weather that moves soil' + src('noaa-ia-summary') + '</div>' +
      '<h2>More of Iowa\'s rain now falls in 2-inch storms</h2>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + wx.precip_annual_avg_in.value + '″</b><span>average yearly rain and snow, ' + wx.precip_annual_avg_in.period + '</span></div>' +
        '<div class="stat"><b>+' + wx.warming_since_1900_f.value + '°F</b><span>warming since 1900, ' + esc(wx.warming_since_1900_f.note) + '</span></div>' +
      '</div>' +
      '<div class="bars">' +
        barRow('Long-term average', hr.long_term_avg, 3, 'var(--lead)', hr.long_term_avg + ' days/yr') +
        barRow('Peak, ' + hr.peak_5yr.period, hr.peak_5yr.value, 3, 'var(--warn)', hr.peak_5yr.value + ' days/yr') +
      '</div>' +
      '<p class="small muted">' + esc(hr.note) + '. Spring averages ' + wx.precip_spring_avg_in.value + '″ and summer ' + wx.precip_summer_avg_in.value + '″, right when fields are bare or crops are small. The wettest year was ' + wx.precip_record_high_in.year + ' (' + wx.precip_record_high_in.value + '″), the driest ' + wx.precip_record_low_in.year + ' (' + wx.precip_record_low_in.value + '″).</p>' +
      '<div class="callout"><p><b>Outlook for 2041 to 2070:</b> ' + esc(wx.projection_2041_2070.annual_precip_change) + ' yearly, and ' + esc(wx.projection_2041_2070.extremes) + '.' + src(wx.projection_2041_2070.source) + '</p></div>' +
      '<p class="small">Rainfall erosivity <b>R</b> runs from ' + wx.rainfall_erosivity_R.min + ' in the northwest to ' + wx.rainfall_erosivity_R.max + ' in the southeast' + src(wx.rainfall_erosivity_R.source) + '. The model starts at ' + D.model.erosion.R.value + ' and lets you choose how fast storms intensify.</p>';

    var bg = ld.soil_background_iowa_mg_kg, sl = ld.screening_levels_ppm, nat = ld.soil_national_medians_mg_kg;
    cards.leadsoil.innerHTML =
      '<div class="eyebrow">Lead in Iowa soil' + src(bg.source) + '</div>' +
      '<h2>Iowa farm soil holds about ' + bg.mean + ' ppm of lead</h2>' +
      '<p>' + bg.samples + ' surface samples taken ' + bg.years + ' ranged from ' + bg.min + ' to ' + bg.max + ' mg/kg, with a median of ' + bg.median + '. That is mostly natural lead from the parent rock and loess.</p>' +
      '<div id="lead-scale"></div>' +
      '<ul class="rows small">' +
        '<li><span>EPA residential screening level' + src(sl.source) + '</span><span>' + sl.residential_screening + ' ppm</span></li>' +
        '<li><span>EPA residential removal level</span><span>' + sl.residential_removal + ' ppm</span></li>' +
        '<li><span>US median, top 5 cm' + src(nat.source) + '</span><span>' + nat.top_0_5cm + ' ppm</span></li>' +
        '<li><span>US median, C horizon (subsoil)</span><span>' + nat.c_horizon + ' ppm</span></li>' +
      '</ul>' +
      '<div id="lead-outlook"></div>';

    var am = ld.air_monitor;
    cards.leadair.innerHTML =
      '<div class="eyebrow">Lead in Iowa air' + src(am.source) + '</div>' +
      '<h2>One lead monitor, in Council Bluffs, now below the limit</h2>' +
      '<p class="small">' + esc(am.site) + ', AQS ' + esc(am.aqs_id) + '. Highest rolling 3-month average each year against the national standard of ' + am.naaqs_ug_m3 + ' µg/m³.</p>' +
      '<div class="bars">' + am.max_rolling_3mo_ug_m3.map(function (r) {
        return barRow(String(r.year), r.value, 0.2, r.value > am.naaqs_ug_m3 ? 'var(--warn)' : 'var(--lead)', r.value.toFixed(2) + ' µg/m³');
      }).join('') + barRow('Standard', am.naaqs_ug_m3, 0.2, 'var(--muted)', am.naaqs_ug_m3.toFixed(2) + ' µg/m³') + '</div>' +
      '<ul class="rows small">' + ld.history.map(function (h) { return '<li><span>' + esc(h.text) + src(h.source) + '</span><span></span></li>'; }).join('') + '</ul>' +
      '<div class="callout lead small"><p><b>From air to soil.</b> Lead that settles out of the air is <span class="num">concentration × deposition speed</span>. At the monitor\'s ' + am.design_value_2023_2025 + ' µg/m³ and ' + D.model.lead_inputs.deposition_velocity_cm_s.value + ' cm/s' + src(D.model.lead_inputs.deposition_velocity_cm_s.source) + ' that is <b class="num">' + M.dryDepositionMgM2Yr(am.design_value_2023_2025, D.model.lead_inputs.deposition_velocity_cm_s.value).toFixed(1) + ' mg/m² a year</b>, an upper estimate because it uses the worst 3-month average. Pick "Beside the Council Bluffs monitor" to run it.</p></div>' +
      '<p class="small muted">For scale: lead fell at about ' + ld.deposition_reference.map(function (d) { return d.value_mg_m2_yr + ' mg/m²/yr in ' + esc(d.place) + ' (' + esc(d.when) + ')' + src(d.source); }).join(', ') + '.</p>';

    renderDetonation();
    renderHay();
    renderEthanol();
    renderCounties();
    renderContribute();
    cards.sources.innerHTML =
      '<div class="eyebrow">Sources</div>' +
      '<h2>Where every number comes from</h2>' +
      '<p class="small muted">Read on ' + esc(D.sources[0].accessed) + '. Values marked <span class="pill assume">assumption</span> are placeholders the model needs; a better source is the most useful pull request you can send.</p>' +
      '<ol class="src-list">' + D.sources.filter(function (s) { return s.id !== 'assumption'; }).map(function (s) {
        return '<li id="src-' + esc(s.id) + '"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>. <span class="muted">' + esc(s.publisher) + (s.note ? '. ' + esc(s.note) : '') + '</span></li>';
      }).join('') + '</ol>';
  }

  function totalValue() { return D.crops.reduce(function (a, c) { return a + (c.value_usd || 0); }, 0); }

  function barRow(label, value, max, color, text) {
    var pct = Math.max(0, Math.min(100, (value / max) * 100));
    return '<div class="bar"><span>' + esc(label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div></div><span class="num">' + esc(text) + '</span></div>';
  }

  // The Nov 25, 2026 lead azide detonation at the Iowa Army Ammunition Plant.
  function renderDetonation() {
    var dt = D.lead.detonation_2026, det = D.model.lead_inputs.detonation;
    var bd = D.model.soil.bulk_density_g_cm3.value, plow = D.model.soil.plow_layer_in.value, top = det.surface_layer_in.value;
    var bgDep = D.model.lead_inputs.background_deposition_mg_m2_yr.value;
    var base = M.detonationPulse(dt.lead_azide_lb, det.escape_fraction.value, det.spread_sq_mi.value);
    var screening = D.lead.screening_levels_ppm.residential_screening;
    var cases = det.compare_areas_sq_mi.map(function (a) {
      return { label: a + ' sq mi, ' + Math.round(det.escape_fraction.value * 100) + '% leaves the plant', p: M.detonationPulse(dt.lead_azide_lb, det.escape_fraction.value, a) };
    });
    cases.push({ label: '1 sq mi, all of it leaves the plant', p: M.detonationPulse(dt.lead_azide_lb, 1, 1), extreme: true });
    var worstTop = M.addedPpm(cases[cases.length - 1].p.mgM2, top, bd);
    cards.detonation.innerHTML =
      '<div class="eyebrow">Nov 25, 2026 · ' + esc(dt.site) + src(dt.site_source) + '</div>' +
      '<h2>The Army set off about ' + num(dt.lead_azide_lb) + ' lb of lead azide</h2>' +
      '<p class="small">' + esc(dt.plan) + '.' + src(dt.plan_source) + ' ' + esc(dt.lead_azide_note) + '.' + src(dt.lead_azide_source) + '</p>' +
      '<ul class="rows small">' + dt.facts.map(function (f) { return '<li><span>' + esc(f.text) + src(f.source) + '</span><span></span></li>'; }).join('') + '</ul>' +
      '<div class="formula">' + num(dt.lead_azide_lb) + ' lb × ' + (M.PB_SHARE_OF_LEAD_AZIDE * 100).toFixed(1) + '% lead = ' + num(base.leadKg) + ' kg of lead' +
        '<small>Lead azide is Pb(N₃)₂, so lead is 207.2 of its 291.2 weight. If ' + Math.round(det.escape_fraction.value * 100) + '% leaves the plant' + src(det.escape_fraction.source) + ' and settles evenly over ' + det.spread_sq_mi.value + ' square miles' + src(det.spread_sq_mi.source) + ', that is <b class="num">' + base.mgM2.toFixed(1) + ' mg/m²</b>, about ' + Math.round(base.mgM2 / bgDep) + ' years of background lead fall in one day.</small></div>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>If it settles on</th><th>Lead fall</th><th>Plowed in (' + plow + ' in)</th><th>Left on top (' + top + ' in)' + src(det.surface_layer_in.source) + '</th></tr></thead><tbody>' +
        cases.map(function (c) {
          return '<tr' + (c.extreme ? ' class="muted"' : '') + '><td>' + esc(c.label) + '</td><td class="num">' + c.p.mgM2.toFixed(c.p.mgM2 < 100 ? 1 : 0) + ' mg/m²</td><td class="num">+' + M.addedPpm(c.p.mgM2, plow, bd).toFixed(2) + ' ppm</td><td class="num">+' + M.addedPpm(c.p.mgM2, top, bd).toFixed(1) + ' ppm</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="callout lead small"><p><b>What the arithmetic says:</b> spread over fields, even the tightest case adds about ' + worstTop.toFixed(0) + ' ppm to the top inch, on soil that already holds about ' + D.lead.soil_background_iowa_mg_kg.mean + ' ppm, against EPA\'s ' + screening + ' ppm residential screening level. These are estimates. The Army\'s maps show a narrower core of heavier fallout, dust on hay, leaves, feed and water is not in the soil yet, and the blast site itself is not in this table. EPA and Army sampling results should replace these numbers when they are published. Pick "' + esc(D.model.lead_inputs.scenarios.filter(function (x) { return x.detonation; })[0].label) + '" to run the ' + det.spread_sq_mi.value + ' square mile case through the ten-year outlook.</p></div>' +
      (dt.army_contours_mg_m2 ? '<p class="small">The Army\'s own model put the ground deposit at ' + dt.army_contours_mg_m2.light.toFixed(2) + ' to ' + dt.army_contours_mg_m2.heavy.toFixed(1) + ' mg/m²' + src(dt.army_contours_mg_m2.source) + ', about a tenth of this page\'s even-spread estimate or less. The hay card shows both.</p>' : '') +
      (dt.history ? '<div class="eyebrow" style="margin-top:14px">The plant before today</div><ul class="rows small">' + dt.history.map(function (h) { return '<li><span>' + esc(h.text) + src(h.source) + '</span><span></span></li>'; }).join('') + '</ul>' : '') +
      '<div class="eyebrow" style="margin-top:14px">Official advice for people in the plume</div>' +
      '<ul class="rows small">' + dt.guidance.map(function (g) { return '<li><span>' + esc(g.text) + src(g.source) + (g.note ? ' <span class="muted">' + esc(g.note) + '</span>' : '') + '</span><span></span></li>'; }).join('') + '</ul>';
  }


  // Hay and cattle: where fallout on forage goes once a cow eats it. All estimates.
  function renderHay() {
    var fd = D.feed, lim = fd.limits, cow = fd.cow, f = fd.forage;
    var dt = D.lead.detonation_2026, det = D.model.lead_inputs.detonation;
    var soil = D.lead.soil_background_iowa_mg_kg.mean;
    var est = M.detonationPulse(dt.lead_azide_lb, det.escape_fraction.value, det.spread_sq_mi.value).mgM2;
    var euDry = lim.eu_forage_mg_kg_12pct.value / 0.88;          // the EU limit is at 12% moisture; this is the same limit on a dry basis
    var codex = lim.codex_milk_mg_kg.value;
    var rows = M.hayCases(est, soil, fd);
    var deposits = [{ label: 'This page\'s estimate', d: est }];
    if (dt.army_contours_mg_m2) {
      deposits.push({ label: 'Army model, heavier contour', d: dt.army_contours_mg_m2.heavy, s: dt.army_contours_mg_m2.source });
      deposits.push({ label: 'Army model, light contour', d: dt.army_contours_mg_m2.light, s: dt.army_contours_mg_m2.source });
    }
    deposits.push({ label: 'No fallout', d: 0 });
    var bgDep = D.model.lead_inputs.background_deposition_mg_m2_yr;
    var day1 = rows[0];
    var flag = function (v, limit) { return v > limit ? ' <span class="pill warn">over</span>' : ''; };
    cards.hay.innerHTML =
      '<div class="eyebrow">Hay and cattle · estimates</div>' +
      '<h2>Most of the lead a cow eats comes back out onto the same field</h2>' +
      '<p class="small">Dust that lands on standing grass sticks to the leaves until rain washes it off. A cow that grazes it passes about ' + Math.round((1 - cow.absorbed_share.value) * 100) + '% out in manure' + src(cow.absorbed_share.source) + ', so the lead moves from grass to ground, not off the farm. The ' + Math.round(cow.absorbed_share.value * 100) + '% she absorbs goes mostly to bone.</p>' +
      '<div class="formula">forage lead = deposit × ' + f.interception_fraction.value + ' ÷ ' + f.standing_biomass_kg_m2.value + ' kg/m²' +
        '<small>' + Math.round(f.interception_fraction.value * 100) + '% of falling dust is caught by the grass' + src(f.interception_fraction.source) + ', spread over ' + f.standing_biomass_kg_m2.value + ' kg of forage per m²' + src(f.standing_biomass_kg_m2.source) + ', and half washes off every ' + f.weathering_half_life_days.value + ' days' + src(f.weathering_half_life_days.source) + '. Normal hay already holds lead from roots' + src(f.soil_to_forage_ratio.source) + ' and the soil baled with it' + src(f.soil_on_hay_share.source) + '.</small></div>' +
      '<p class="small muted">At this page\'s ' + est.toFixed(1) + ' mg/m² estimate, for a beef cow eating ' + cow.dry_matter_intake_kg_day.value + ' kg of forage' + src(cow.dry_matter_intake_kg_day.source) + ' and ' + cow.soil_eaten_kg_day.value + ' kg of soil a day' + src(cow.soil_eaten_kg_day.source) + ':</p>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>Feed</th><th>Forage lead (dry)</th><th>Cow eats</th><th>Milk, if she kept at it' + src(cow.milk_transfer_d_per_l.source) + '</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.label) + '</td><td class="num">' + r.forage.toFixed(1) + ' mg/kg' + flag(r.forage, euDry) + '</td><td class="num">' + Math.round(r.cow.intakeMg) + ' mg/day</td><td class="num">' + r.cow.milkMgL.toFixed(3) + ' mg/L' + flag(r.cow.milkMgL, codex) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<p class="small muted">Limits: cattle tolerate up to ' + lim.nrc_max_diet_mg_kg_dm.value + ' mg/kg in the diet' + src(lim.nrc_max_diet_mg_kg_dm.source) + '; the EU allows ' + lim.eu_forage_mg_kg_12pct.value + ' mg/kg in forage (about ' + euDry.toFixed(0) + ' dry)' + src(lim.eu_forage_mg_kg_12pct.source) + '; Codex allows ' + codex + ' mg/kg in milk' + src(lim.codex_milk_mg_kg.source) + '.</p>' +
      '<div class="eyebrow" style="margin-top:14px">How much depends on the fallout, day one on pasture</div>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>Deposit</th><th>mg/m²</th><th>Forage</th><th>Milk</th></tr></thead><tbody>' +
        deposits.map(function (x) {
          var r = M.hayCases(x.d, soil, fd)[0];
          return '<tr><td>' + esc(x.label) + (x.s ? src(x.s) : '') + '</td><td class="num">' + x.d.toFixed(2) + '</td><td class="num">' + r.forage.toFixed(1) + ' mg/kg</td><td class="num">' + r.cow.milkMgL.toFixed(3) + ' mg/L' + flag(r.cow.milkMgL, codex) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="eyebrow" style="margin-top:14px">Where the lead a cow absorbs collects' + src(cow.tissue_rank_source) + '</div>' +
      '<div class="bars">' + cow.tissue_rank.map(function (t) {
        return barRow(t.tissue, t.value, cow.tissue_rank[0].value, 'var(--lead)', Math.round(t.value / cow.tissue_rank[cow.tissue_rank.length - 1].value) + '× milk');
      }).join('') + '</div>' +
      '<p class="small muted">Relative amounts only, per mg eaten each day. Bone holds lead for months to years; blood clears with a half-life of about ' + cow.blood_half_life_days.value + ' days' + src(cow.blood_half_life_days.source) + '.</p>' +
      '<div class="callout lead small"><p><b>What it means:</b> at this page\'s upper estimate, forage stays under the cattle and EU feed limits, but milk from cows grazing fresh fallout every day would pass the Codex level until rain washes the grass. At the Army\'s modeled deposits it stays under. Hay baled before today and stored inside got none of it; bales left outside gained about ' + (rows[3].forage - rows[4].forage).toFixed(2) + ' mg/kg. Next year\'s hay grows from soil that gained about ' + M.addedPpm(est, D.model.soil.plow_layer_in.value, D.model.soil.bulk_density_g_cm3.value).toFixed(2) + ' ppm, too little to see. For scale, 20 years of normal lead fall is about ' + (bgDep.value * 20).toFixed(0) + ' mg/m²' + src(bgDep.source) + ', near this page\'s one-day estimate. These are estimates until forage and milk samples are published.</p></div>';
  }

  // Ethanol: lead stays with the solids, not the fuel.
  function renderEthanol() {
    var c = D.feed.corn, lim = D.feed.limits, soil = D.lead.soil_background_iowa_mg_kg.mean;
    var e = M.ethanolPathway(soil, c.grain_to_soil_ratio.low, c.grain_to_soil_ratio.high, c.ddgs_concentration_factor.value);
    cards.ethanol.innerHTML =
      '<div class="eyebrow">Corn to ethanol · estimates</div>' +
      '<h2>Lead does not go into the fuel, so burning it puts none back in the air</h2>' +
      '<p class="small">Ethanol is distilled at ' + 78 + ' °C; lead boils at ' + num(c.lead_boils_c.value) + ' °C' + src(c.lead_boils_c.source) + ', so it stays behind with the solids. ' + esc(c.per_bushel.text) + '.' + src(c.per_bushel.source) + ' The starch becomes fuel, so whatever lead the kernels held ends up about ' + c.ddgs_concentration_factor.value + ' times as concentrated in the distillers grains' + src(c.ddgs_concentration_factor.source) + ', which are sold as cattle and hog feed.</p>' +
      '<ul class="rows small">' +
        '<li><span>Corn grain, from ' + soil + ' ppm soil' + src(c.grain_to_soil_ratio.source) + '</span><span>' + e.grainLow.toFixed(2) + ' to ' + e.grainHigh.toFixed(2) + ' mg/kg</span></li>' +
        '<li><span>Distillers grains made from it</span><span>' + e.ddgsLow.toFixed(2) + ' to ' + e.ddgsHigh.toFixed(2) + ' mg/kg</span></li>' +
        '<li><span>EU limit for feed materials' + src(lim.eu_feed_material_mg_kg_12pct.source) + '</span><span>' + lim.eu_feed_material_mg_kg_12pct.value + ' mg/kg</span></li>' +
        '<li><span>Ethanol fuel</span><span>none</span></li>' +
      '</ul>' +
      '<p class="small">' + esc(c.ddgs_measured.text) + '.' + src(c.ddgs_measured.source) + '</p>' +
      '<div class="callout lead small"><p><b>Today\'s fallout and this year\'s corn:</b> ' + c.iowa_harvested_pct_nov15.value + '% of Iowa corn was harvested by Nov 15' + src(c.iowa_harvested_pct_nov15.source) + ', so most grain was in bins before the blast. Corn still standing could pick up dust on the husk; about ' + Math.round(c.foliar_to_grain_share.value * 100) + '% of lead landing on a cereal plant reaches the grain' + src(c.foliar_to_grain_share.source) + ', and at this stage likely less. Nearby plants: ' + c.plants_nearby.map(function (p) { return esc(p.text) + src(p.source); }).join('; ') + '.</p></div>';
  }

  // The farm counties around the plant and along the plume path.
  function renderCounties() {
    var cs = D.counties;
    var tot = function (k) { return cs.reduce(function (a, c) { return a + (c[k] || 0); }, 0); };
    var path = function (c) { return c.on_plume_path === 'plant' ? 'the plant' : c.on_plume_path === 'yes' ? 'yes' : c.on_plume_path === 'no' ? 'no' : esc(c.on_plume_path); };
    cards.counties.innerHTML =
      '<div class="eyebrow">Counties near the plant' + src(cs[0].source) + src('census-2022-cp-mo') + src(cs[0].cows_source) + '</div>' +
      '<h2>' + num(tot('farms')) + ' farms in the nine counties nearest the blast</h2>' +
      '<p class="small">USDA says about 350 farms in Iowa and Missouri lie in the projected plume' + src('aljazeera-350-farms') + ', but no agency has named them. These are the counties around the plant and along the Army\'s final southwest path toward Keokuk and Macon, plus the two the earlier forecast pointed at.</p>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>County</th><th>Farms</th><th>Hay acres</th><th>Cattle</th><th>Beef cows</th><th>Milk cows</th><th>Plume path</th></tr></thead><tbody>' +
        cs.map(function (c) {
          return '<tr><td>' + esc(c.name) + ', ' + esc(c.state) + (c.in_proclamation === 'yes' ? ' <span class="pill warn">proclamation</span>' : '') + '</td><td class="num">' + num(c.farms) + '</td><td class="num">' + num(c.hay_acres) + '</td><td class="num">' + num(c.cattle_head) + '</td><td class="num">' + (c.beef_cows == null ? 'n/a' : num(c.beef_cows)) + '</td><td class="num">' + (c.milk_cows == null ? 'n/a' : num(c.milk_cows)) + '</td><td>' + path(c) + '</td></tr>';
        }).join('') +
        '<tr><td><b>Total</b></td><td class="num"><b>' + num(tot('farms')) + '</b></td><td class="num"><b>' + num(tot('hay_acres')) + '</b></td><td class="num"><b>' + num(tot('cattle_head')) + '</b></td><td></td><td></td><td></td></tr>' +
      '</tbody></table></div>' +
      '<p class="small muted">Farms, hay and cattle from the 2022 Census of Agriculture; cows from USDA county estimates for Jan 1, 2024, where published (n/a means withheld or not listed). "Proclamation" marks the counties named in Iowa\'s disaster proclamation' + src('abc7-iaaap-2026') + '. The plume path is from the Army\'s forecast maps, not from sampling.</p>';
  }

  function renderContribute() {
    var repo = D.site.repo, br = D.site.branch || 'main';
    var gh = repo ? 'https://github.com/' + repo : '';
    var links = repo
      ? '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
          '<a class="btn" target="_blank" rel="noopener" href="' + esc(gh + '/edit/' + br + '/data/crops.csv') + '">Correct crop data</a>' +
          '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(gh + '/edit/' + br + '/data/model.json') + '">Improve the model</a>' +
          '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(gh + '/edit/' + br + '/data/sources.json') + '">Add a source</a>' +
          '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(gh + '/issues/new/choose') + '">Report a problem</a>' +
        '</div>'
      : '<p class="small muted">Edit buttons appear here once the GitHub repository is published.</p>';
    cards.contribute.innerHTML =
      '<div class="eyebrow">Contribute</div>' +
      '<h2>See a wrong number? Fix it with a pull request</h2>' +
      '<p>All of the data lives in plain files in the <span class="num">data/</span> folder, so a correction is a one-line edit you can make in the browser on GitHub.</p>' +
      '<ol class="steps">' +
        '<li>Open the file: <span class="num">crops.csv</span> for USDA figures, <span class="num">lead.json</span> and <span class="num">weather.json</span> for measurements, <span class="num">model.json</span> for model inputs.</li>' +
        '<li>Change the value and point its <span class="num">source</span> at an entry in <span class="num">sources.json</span>, adding one if needed.</li>' +
        '<li>Open a pull request. A check runs the data tests, and the site rebuilds when it is merged.</li>' +
      '</ol>' + links;
  }

  // ---------- scenario-dependent cards ----------
  function refresh() {
    var run = M.runAll(D.crops, D.model, D.lead, settings);
    var byId = {}; run.crops.forEach(function (r) { byId[r.id] = r; });
    var rowCrops = run.crops.filter(function (r) { return r.id === 'corn_grain' || r.id === 'soybeans'; });
    var rowAvg = rowCrops.reduce(function (a, r) { return a + r.years[0].tonsPerAcre; }, 0) / rowCrops.length;
    var total = run.crops.reduce(function (a, r) { return a + r.statewideTons; }, 0);
    var years = D.model.start_year + ' to ' + D.model.end_year;

    cards.hero.innerHTML =
      '<div class="eyebrow">Iowa · ' + years + ' · estimates</div>' +
      '<h1>Iowa Soil Ledger</h1>' +
      '<p class="lede">How much of Iowa\'s topsoil, and its lead, the state\'s crops could move in the next ten seasons, built from USDA, EPA, USGS, NOAA and Iowa DNR data.</p>' +
      '<div class="horizon" aria-hidden="true"><div class="a">A · TOPSOIL</div><div class="b">B · SUBSOIL</div><div class="c">C · LOESS PARENT MATERIAL</div></div>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + compact(total) + '</b><span>tons of soil off harvested acres, ' + years + '</span></div>' +
        '<div class="stat"><b>' + rowAvg.toFixed(1) + '</b><span>tons/acre in ' + D.model.start_year + ', corn and soybeans averaged</span></div>' +
        '<div class="stat"><b>' + D.model.erosion.T.value + '</b><span>tons/acre a year most Iowa soils can tolerate' + src(D.model.erosion.T.source) + '</span></div>' +
      '</div>' +
      '<p class="small">Measured Iowa erosion averaged 4.7 to 5.2 tons an acre in 2007' + src('ewg-losing-ground') + ', right at that limit. Change tillage, storm intensity and slope at the top and every card updates.</p>' +
      '<p class="small muted">Drag to move. Pinch, or hold Ctrl and scroll, to zoom. Projections are estimates from a simple public model, not measurements.</p>';

    cards.crops.innerHTML =
      '<div class="eyebrow" style="padding-left:4px">2025 crops' + src('nass-ia-2025') + ' and their soil outlook, ' + years + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:12px">' +
      D.crops.map(function (c) { return cropCard(c, byId[c.id]); }).join('') + '</div>';

    var maxT = Math.max.apply(null, run.crops.map(function (r) { return r.statewideTons; }));
    var pbTons = run.crops.reduce(function (a, r) { return a + r.pbExportedGramsPerAcre * r.acres; }, 0) / 1e6;
    cards.statewide.innerHTML =
      '<div class="eyebrow">Statewide, ' + years + ' · ' + tillageLabel() + ' · ' + esc(run.trend.label.toLowerCase()) + '</div>' +
      '<h2>' + compact(total) + ' tons of soil leave Iowa\'s harvested acres in ten seasons</h2>' +
      '<div class="bars">' + run.crops.slice().sort(function (a, b) { return b.statewideTons - a.statewideTons; }).map(function (r) {
        return barRow(r.name, r.statewideTons, maxT, cropColor(r.id), compact(r.statewideTons) + ' tons');
      }).join('') + '</div>' +
      '<p class="small">That soil carries about <b class="num">' + num(pbTons) + ' tons of lead</b> with it into ditches and rivers. Almost all of it is the natural lead already in the soil, not new pollution.</p>' +
      '<p class="small muted">Uses harvested acres from the USDA table, so acres double-cropped or cut for forage are counted once per crop. Each acre is treated as an average Iowa field (R ' + D.model.erosion.R.value + ', K ' + D.model.erosion.K.value + ', LS ' + settings.LS.toFixed(1) + '); real fields vary a lot by slope.</p>';

    renderModel(run);
    renderLeadOutlook(run);
    stack();
  }

  function tillageLabel() { return { conventional: 'plowed', reduced: 'reduced tillage', notill: 'no-till' }[settings.tillage]; }

  function cropCard(c, r) {
    if (!r) return '';
    var cfg = D.model.crops[c.id];
    var first = r.years[0].tonsPerAcre, last = r.years[r.years.length - 1].tonsPerAcre;
    var over = r.yearsOverT > 0;
    var pill = over
      ? '<span class="pill warn">Over the ' + D.model.erosion.T.value + '-ton limit ' + r.yearsOverT + ' of ' + r.years.length + ' years</span>'
      : '<span class="pill ok">Within the ' + D.model.erosion.T.value + '-ton limit</span>';
    return '<article class="card crop" style="position:relative;--crop:' + cropColor(c.id) + '">' +
      '<div class="crop-head"><h3>' + esc(c.name) + '</h3><span class="crop-value">' + usd(c.value_usd) + '</span></div>' +
      '<dl class="kv">' +
        '<dt>Harvested</dt><dd>' + compact(c.harvested_acres) + ' ac</dd>' +
        '<dt>Yield</dt><dd>' + num(c.yield, c.yield % 1 ? 2 : 0) + ' ' + esc(c.yield_unit) + '</dd>' +
        '<dt>Production</dt><dd>' + compact(c.production) + ' ' + esc(c.production_unit) + '</dd>' +
        (c.price ? '<dt>Price</dt><dd>' + c.price + ' ' + esc(c.price_unit) + '</dd>' : '') +
      '</dl>' +
      '<div class="crop-body">' + soilColumn(r) + spark(r, cfg) + '</div>' +
      '<div>' + pill + '</div>' +
      '<p class="small"><b class="num">' + first.toFixed(1) + '→' + last.toFixed(1) + '</b> tons/acre a year. Lead in the plow layer goes <b class="num">' + r.pbStart.toFixed(1) + '→' + r.pbEnd.toFixed(1) + '</b> ppm.</p>' +
      '<p class="small muted">C factor ' + r.C + src(cfg.source) + (cfg.note ? ' · ' + esc(cfg.note) : '') + '</p>' +
      '</article>';
  }

  // A to-scale soil column: the 8-inch plow layer with the depth lost by the end year cut away at the top.
  function soilColumn(r) {
    var pxIn = 22, depth = D.model.soil.plow_layer_in.value, h = depth * pxIn;
    var lost = Math.min(depth, r.totalInches) * pxIn;
    return '<svg viewBox="0 0 70 ' + (h + 34) + '" width="70" role="img" aria-label="' + r.totalInches.toFixed(2) + ' inches of topsoil lost">' +
      '<rect x="8" y="' + (14 + lost) + '" width="40" height="' + (h - lost) + '" fill="var(--topsoil)"/>' +
      '<rect x="8" y="14" width="40" height="' + Math.max(lost, 0.5) + '" fill="none" stroke="var(--warn)" stroke-dasharray="3 2"/>' +
      '<rect x="8" y="' + (14 + h) + '" width="40" height="14" fill="var(--subsoil)"/>' +
      '<text x="8" y="10" font-size="10" fill="var(--warn)">−' + r.totalInches.toFixed(2) + '″</text>' +
      '<text x="52" y="' + (14 + h / 2) + '" font-size="9" fill="var(--muted)">' + depth + '″</text>' +
      '</svg>';
  }

  // Tons per acre each year against the tolerance line T.
  function spark(r, cfg) {
    var W = 230, H = 120, pl = 26, pr = 6, pt = 10, pb = 20;
    var T = D.model.erosion.T.value;
    var ymax = Math.max(T * 1.5, Math.max.apply(null, r.years.map(function (y) { return y.tonsPerAcre; })) * 1.15);
    var x = function (i) { return pl + (i / (r.years.length - 1)) * (W - pl - pr); };
    var y = function (v) { return pt + (1 - v / ymax) * (H - pt - pb); };
    var pts = r.years.map(function (yr, i) { return x(i).toFixed(1) + ',' + y(yr.tonsPerAcre).toFixed(1); });
    var area = 'M' + x(0) + ',' + y(0) + ' L' + pts.join(' L') + ' L' + x(r.years.length - 1) + ',' + y(0) + ' Z';
    var col = 'var(--' + (cfg.color || 'corn') + ')';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Tons per acre each year">' +
      '<line class="chart-axis" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
      '<path d="' + area + '" fill="' + col + '" fill-opacity="0.18"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2.2"/>' +
      '<circle cx="' + x(r.years.length - 1) + '" cy="' + y(r.years[r.years.length - 1].tonsPerAcre) + '" r="3.5" fill="' + col + '"/>' +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(T) + '" y2="' + y(T) + '" stroke="var(--warn)" stroke-dasharray="4 3"/>' +
      '<text class="chart-label" x="' + (pl - 4) + '" y="' + (y(T) + 4) + '" text-anchor="end">T ' + T + '</text>' +
      '<text class="chart-label" x="' + (pl - 4) + '" y="' + (y(0) + 4) + '" text-anchor="end">0</text>' +
      '<text class="chart-label" x="' + pl + '" y="' + (H - 4) + '">' + r.years[0].year + '</text>' +
      '<text class="chart-label" x="' + (W - pr) + '" y="' + (H - 4) + '" text-anchor="end">' + r.years[r.years.length - 1].year + '</text>' +
      '</svg>';
  }

  function renderLeadOutlook(run) {
    var sl = D.lead.screening_levels_ppm, bg = D.lead.soil_background_iowa_mg_kg;
    var W = 520, H = 76, max = 650, x = function (v) { return 10 + (v / max) * (W - 20); };
    var corn = run.crops.filter(function (r) { return r.id === 'corn_grain'; })[0];
    var hay = run.crops.filter(function (r) { return r.id === 'alfalfa'; })[0];
    document.getElementById('lead-scale').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Iowa soil lead compared with EPA levels">' +
      '<line class="chart-axis" x1="10" x2="' + (W - 10) + '" y1="36" y2="36" stroke-width="8" stroke-linecap="round"/>' +
      '<rect x="' + x(bg.min) + '" y="30" width="' + (x(bg.max) - x(bg.min)) + '" height="12" rx="3" fill="var(--lead)"/>' +
      '<line x1="' + x(sl.residential_screening) + '" x2="' + x(sl.residential_screening) + '" y1="22" y2="50" stroke="var(--warn)" stroke-width="2"/>' +
      '<line x1="' + x(sl.residential_removal) + '" x2="' + x(sl.residential_removal) + '" y1="22" y2="50" stroke="var(--warn)" stroke-width="2"/>' +
      '<text class="chart-label" x="' + x(bg.min) + '" y="16">Iowa soil ' + bg.min + '–' + bg.max + '</text>' +
      '<text class="chart-label" x="' + x(sl.residential_screening) + '" y="66" text-anchor="middle">' + sl.residential_screening + ' screening</text>' +
      '<text class="chart-label" x="' + x(sl.residential_removal) + '" y="66" text-anchor="end">' + sl.residential_removal + ' removal</text>' +
      '<text class="chart-label" x="10" y="66">0 ppm</text>' +
      '</svg>';
    document.getElementById('lead-outlook').innerHTML =
      '<div class="callout lead"><p><b>Outlook, ' + esc(run.scenario.label) + ':</b> lead added at <span class="num">' + run.depositionMgM2Yr.toFixed(2) + ' mg/m²</span> a year' +
      (run.scenario.manure ? ' plus manure at ' + D.model.lead_inputs.manure_pb_mg_kg_dry.value + ' mg/kg' + src(D.model.lead_inputs.manure_pb_mg_kg_dry.source) : '') +
      (run.pulse ? ', plus a one-time <span class="num">' + run.pulse.mgM2.toFixed(1) + ' mg/m²</span> from the Nov 25 detonation in ' + run.pulse.year + ' (an estimate)' : '') +
      '. By ' + D.model.end_year + ' a corn field goes from <b class="num">' + corn.pbStart.toFixed(1) + '</b> to <b class="num">' + corn.pbEnd.toFixed(1) + '</b> ppm and an alfalfa field to <b class="num">' + hay.pbEnd.toFixed(1) + '</b> ppm.</p></div>' +
      '<p class="small">At these rates lead in Iowa farm soil barely changes in ten years and stays far below EPA levels. Erosion is the larger threat. ' +
      (corn.pbEnd < corn.pbStart
        ? 'Corn fields lose topsoil and mix in subsoil that holds a little less lead, so their lead drifts down even as some is added.'
        : 'Here the lead added outweighs what erosion carries off, so it creeps up by ' + (corn.pbEnd - corn.pbStart).toFixed(1) + ' ppm over the decade.') + '</p>';
  }

  function renderModel(run) {
    var e = D.model.erosion, s = D.model.soil, li = D.model.lead_inputs;
    var row = function (name, v, unit, source, note) {
      return '<tr><td>' + name + '</td><td class="num">' + v + (unit ? ' ' + esc(unit) : '') + '</td><td>' + src(source) + (note ? ' <span class="muted">' + esc(note) + '</span>' : '') + '</td></tr>';
    };
    cards.model.innerHTML =
      '<div class="eyebrow">How the outlook is calculated</div>' +
      '<h2>Two formulas, run once a year for ten seasons</h2>' +
      '<div class="formula">A = R × K × LS × C × P<small>Revised Universal Soil Loss Equation: tons of soil lost per acre each year. R rises each year by the rain intensity you pick (' + esc(run.trend.label) + ').</small></div>' +
      '<div class="formula">c′ = c + (E·(c<sub>sub</sub> − c) + I) / M<small>Lead in the plow layer: eroded soil E leaves with its lead c, the same mass of subsoil at c<sub>sub</sub> mixes in, and air, manure and the one-time detonation pulse add I. M is the plow layer\'s mass.</small></div>' +
      '<p class="small">Topsoil depth lost = tons lost ÷ <span class="num">' + M.tonsPerAcreInch(s.bulk_density_g_cm3.value).toFixed(1) + '</span> tons in one acre-inch at ' + s.bulk_density_g_cm3.value + ' g/cm³.</p>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>Input</th><th>Value</th><th>Source</th></tr></thead><tbody>' +
        row('R, rainfall erosivity', e.R.value, '', e.R.source, e.R.note) +
        row('K, soil erodibility', e.K.value, '', e.K.source, e.K.note) +
        row('LS, slope length and steepness', settings.LS.toFixed(1), '', e.LS.source, 'Set with the slider. ' + e.LS.note) +
        row('P, conservation practice', e.P.value, '', e.P.source, e.P.note) +
        row('T, tolerable loss', e.T.value, e.T.unit, e.T.source, e.T.note) +
        row('Rain intensity trend', (run.trend.per_year * 100).toFixed(1) + '%', 'a year', 'assumption', e.R_trend_note) +
        row('Plow layer depth', s.plow_layer_in.value, 'in', s.plow_layer_in.source, s.plow_layer_in.note) +
        row('Bulk density', s.bulk_density_g_cm3.value, 'g/cm³', s.bulk_density_g_cm3.source, s.bulk_density_g_cm3.note) +
        row('Starting soil lead', D.lead.soil_background_iowa_mg_kg.mean, 'mg/kg', D.lead.soil_background_iowa_mg_kg.source, 'Iowa mean') +
        row('Subsoil lead', s.subsoil_pb_mg_kg.value, 'mg/kg', s.subsoil_pb_mg_kg.source, s.subsoil_pb_mg_kg.note) +
        row('Background lead deposition', li.background_deposition_mg_m2_yr.value, 'mg/m²/yr', li.background_deposition_mg_m2_yr.source, li.background_deposition_mg_m2_yr.note) +
        row('Deposition speed', li.deposition_velocity_cm_s.value, 'cm/s', li.deposition_velocity_cm_s.source, li.deposition_velocity_cm_s.note) +
        row('Detonation lead leaving the plant', Math.round(li.detonation.escape_fraction.value * 100) + '%', '', li.detonation.escape_fraction.source, li.detonation.escape_fraction.note) +
        row('Detonation fallout area', li.detonation.spread_sq_mi.value, 'sq mi', li.detonation.spread_sq_mi.source, li.detonation.spread_sq_mi.note) +
        row('Manure lead, rate', li.manure_pb_mg_kg_dry.value + ' mg/kg, ' + li.manure_rate_dry_tons_ac_yr.value, 'dry t/ac/yr', li.manure_rate_dry_tons_ac_yr.source, li.manure_rate_dry_tons_ac_yr.note) +
      '</tbody></table></div>' +
      '<div style="overflow-x:auto"><table class="inputs"><thead><tr><th>Crop</th><th>C, plowed</th><th>C, reduced</th><th>C, no-till</th></tr></thead><tbody>' +
        D.crops.map(function (c) {
          var C = D.model.crops[c.id].C;
          var cell = function (t) { return '<td class="num"' + (t === settings.tillage ? ' style="font-weight:700"' : '') + '>' + C[t] + '</td>'; };
          return '<tr><td>' + esc(c.name) + src(D.model.crops[c.id].source) + '</td>' + cell('conventional') + cell('reduced') + cell('notill') + '</tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<p class="small muted">What this leaves out: gullies, wind erosion, tile drainage, crop rotation within a field, yield effects of thinner topsoil, and lead taken up by plants. The model is meant to compare crops and practices, not to predict any one field.</p>';
  }

  // ---------- pan and zoom ----------
  function apply(glide) {
    world.classList.toggle('glide', !!glide);
    world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
    viewport.style.backgroundSize = (24 * view.s) + 'px ' + (24 * view.s) + 'px';
    viewport.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    document.getElementById('zoom-level').textContent = Math.round(view.s * 100) + '%';
  }
  function clampS(s) { return Math.max(0.12, Math.min(3, s)); }
  function zoomAt(px, py, factor) {
    var s = clampS(view.s * factor);
    view.x = px - (px - view.x) * (s / view.s);
    view.y = py - (py - view.y) * (s / view.s);
    view.s = s;
    apply(false);
  }
  function hudBottom() { return document.getElementById('hud').offsetHeight; }
  function fitBox(b, glide) {
    var top = hudBottom() + 16, bottom = 80, pad = 24;
    var aw = window.innerWidth - pad * 2, ah = window.innerHeight - top - bottom;
    var s = clampS(Math.min(aw / b.w, ah / b.h, 1.1));
    view.s = s;
    view.x = pad + (aw - b.w * s) / 2 - b.x * s;
    view.y = top + Math.max(0, (ah - b.h * s) / 2) - b.y * s;
    apply(glide);
  }
  function flyTo(el, glide) { fitBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: Math.min(el.offsetHeight, 1400) }, glide); }
  function fitAll(glide) {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    Object.keys(cards).forEach(function (k) {
      var b = box(k);
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    });
    fitBox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, glide);
  }

  var pointers = {}, last = null, moved = 0;
  function interactive(t) { return t.closest('a, button, input, select, label, textarea, output'); }
  viewport.addEventListener('pointerdown', function (e) {
    if (interactive(e.target)) return;
    viewport.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    last = null; moved = 0;
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    var prev = pointers[e.pointerId];
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 1) {
      view.x += e.clientX - prev.x; view.y += e.clientY - prev.y;
      moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
      apply(false);
    } else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (last) {
        view.x += mx - last.mx; view.y += my - last.my;
        zoomAt(mx, my, d / last.d);
      }
      last = { d: d, mx: mx, my: my };
    }
  });
  function up(e) {
    delete pointers[e.pointerId];
    last = null;
    if (!Object.keys(pointers).length) viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else { view.x -= e.deltaX; view.y -= e.deltaY; apply(false); }
  }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var k = e.key;
    if (k === '+' || k === '=') zoomAt(cx, cy, 1.2);
    else if (k === '-' || k === '_') zoomAt(cx, cy, 1 / 1.2);
    else if (k === '0') fitAll(true);
    else if (k === 'ArrowLeft') { view.x += 80; apply(false); }
    else if (k === 'ArrowRight') { view.x -= 80; apply(false); }
    else if (k === 'ArrowUp') { view.y += 80; apply(false); }
    else if (k === 'ArrowDown') { view.y -= 80; apply(false); }
    else return;
    e.preventDefault();
  });
  document.getElementById('zoom-in').addEventListener('click', function () { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25); });
  document.getElementById('zoom-out').addEventListener('click', function () { zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.8); });
  document.getElementById('zoom-fit').addEventListener('click', function () { fitAll(true); });
  window.addEventListener('resize', function () { apply(false); });
})();
