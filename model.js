/*
 * Iowa Soil Ledger model.
 *
 * Two small, transparent calculations, run year by year from 2026 to 2035:
 *
 * 1. Erosion (RUSLE):   A = R x K x LS x C x P      (tons per acre per year)
 *    R grows each year by the chosen rain trend:  R_year = R x (1 + trend)^(year - base_year)
 *    Topsoil lost (inches) = tons lost / tons in one acre-inch of soil.
 *
 * 2. Lead in the plow layer (a mass balance on one acre):
 *    Each year eroded soil leaves with its lead, the same mass of subsoil is
 *    mixed in from below at the subsoil lead level, and air and manure add lead.
 *      c_next = c + (E x (c_sub - c) + inputs) / M
 *    where M is the plow layer mass (kg), E the eroded mass (kg) and inputs in mg.
 *
 * The same file runs in the browser (window.IowaModel) and in Node (require).
 */
(function (root) {
  'use strict';

  var M2_PER_ACRE = 4046.8564;
  var KG_PER_SHORT_TON = 907.18474;
  var SECONDS_PER_YEAR = 31557600;

  /** Short tons of soil in one acre, one inch deep, at a bulk density in g/cm3. */
  function tonsPerAcreInch(bulkDensity) {
    var m3 = M2_PER_ACRE * 0.0254;          // 102.79 m3
    var kg = m3 * bulkDensity * 1000;       // g/cm3 = 1000 kg/m3
    return kg / KG_PER_SHORT_TON;           // about 150.7 at 1.33
  }

  /** Lead falling out of air: concentration (ug/m3) x deposition speed (cm/s), in mg/m2/yr. */
  function dryDepositionMgM2Yr(airUgM3, velocityCmS) {
    var ugPerM2PerS = airUgM3 * (velocityCmS / 100);
    return (ugPerM2PerS * SECONDS_PER_YEAR) / 1000;
  }

  /**
   * Run the outlook for one crop.
   * opts: { C, R, K, LS, P, T, rTrend, baseYear, startYear, endYear,
   *         bulkDensity, plowLayerIn, pb0, pbSub, depositionMgM2Yr, manurePbMgKg, manureDryTonsAc }
   */
  function runCrop(opts) {
    var perInch = tonsPerAcreInch(opts.bulkDensity);
    var plowKg = opts.plowLayerIn * perInch * KG_PER_SHORT_TON;
    var inputsMg =
      opts.depositionMgM2Yr * M2_PER_ACRE +
      (opts.manureDryTonsAc || 0) * KG_PER_SHORT_TON * (opts.manurePbMgKg || 0);

    var pb = opts.pb0;
    var cumTons = 0;
    var pbExportedMg = 0;
    var yearsOverT = 0;
    var years = [];

    for (var y = opts.startYear; y <= opts.endYear; y++) {
      var R = opts.R * Math.pow(1 + opts.rTrend, y - opts.baseYear);
      var A = R * opts.K * opts.LS * opts.C * opts.P;
      var erodedKg = A * KG_PER_SHORT_TON;
      pbExportedMg += erodedKg * pb;
      pb = pb + (erodedKg * (opts.pbSub - pb) + inputsMg) / plowKg;
      cumTons += A;
      if (A > opts.T) yearsOverT++;
      years.push({ year: y, R: R, tonsPerAcre: A, cumTons: cumTons, cumInches: cumTons / perInch, pb: pb });
    }

    return {
      years: years,
      totalTonsPerAcre: cumTons,
      totalInches: cumTons / perInch,
      yearsOverT: yearsOverT,
      pbStart: opts.pb0,
      pbEnd: pb,
      pbExportedGramsPerAcre: pbExportedMg / 1000
    };
  }

  /**
   * Run every crop with the shared settings.
   * crops: rows from crops.csv; model: model.json; lead: lead.json
   * settings: { tillage: 'conventional'|'reduced'|'notill', trendId, LS, scenarioId }
   */
  function runAll(crops, model, lead, settings) {
    var e = model.erosion;
    var trend = e.R_trend_options.filter(function (o) { return o.id === settings.trendId; })[0] || e.R_trend_options[0];
    var li = model.lead_inputs;
    var scenario = li.scenarios.filter(function (s) { return s.id === settings.scenarioId; })[0] || li.scenarios[0];
    var deposition = scenario.air_ug_m3 > 0
      ? dryDepositionMgM2Yr(scenario.air_ug_m3, li.deposition_velocity_cm_s.value)
      : li.background_deposition_mg_m2_yr.value;

    var results = crops.filter(function (c) { return model.crops[c.id]; }).map(function (crop) {
      var cfg = model.crops[crop.id];
      var out = runCrop({
        C: cfg.C[settings.tillage],
        R: e.R.value, K: e.K.value, LS: settings.LS != null ? settings.LS : e.LS.value, P: e.P.value, T: e.T.value,
        rTrend: trend.per_year,
        baseYear: model.base_year, startYear: model.start_year, endYear: model.end_year,
        bulkDensity: model.soil.bulk_density_g_cm3.value,
        plowLayerIn: model.soil.plow_layer_in.value,
        pb0: lead.soil_background_iowa_mg_kg.mean,
        pbSub: model.soil.subsoil_pb_mg_kg.value,
        depositionMgM2Yr: deposition,
        manurePbMgKg: scenario.manure ? li.manure_pb_mg_kg_dry.value : 0,
        manureDryTonsAc: scenario.manure ? li.manure_rate_dry_tons_ac_yr.value : 0
      });
      out.id = crop.id;
      out.name = crop.name;
      out.C = cfg.C[settings.tillage];
      out.acres = crop.harvested_acres;
      out.statewideTons = out.totalTonsPerAcre * crop.harvested_acres;
      return out;
    });

    return { crops: results, depositionMgM2Yr: deposition, scenario: scenario, trend: trend };
  }

  /** Minimal CSV parser: handles quoted fields with commas. Numbers become numbers, blanks become null. */
  function parseCSV(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    var split = function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') { q = !q; continue; }
        if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur);
      return out;
    };
    var head = split(lines[0]);
    return lines.slice(1).map(function (line) {
      var cells = split(line), row = {};
      head.forEach(function (h, i) {
        var v = (cells[i] || '').trim();
        row[h] = v === '' ? null : (isFinite(v) && /^-?[\d.]+$/.test(v) ? Number(v) : v);
      });
      return row;
    });
  }

  var api = { tonsPerAcreInch: tonsPerAcreInch, dryDepositionMgM2Yr: dryDepositionMgM2Yr, runCrop: runCrop, runAll: runAll, parseCSV: parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IowaModel = api;
})(this);
