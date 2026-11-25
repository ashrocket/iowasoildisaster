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
 * 3. A one-time lead pulse (the Nov 25, 2026 lead azide detonation):
 *    lead (kg) = lead azide (kg) x lead's share of Pb(N3)2 by weight
 *    pulse (mg/m2) = lead x share leaving the plant / area it settles on
 *    It is added to the plow layer in its year like any other input.
 *
 * The same file runs in the browser (window.IowaModel) and in Node (require).
 */
(function (root) {
  'use strict';

  var M2_PER_ACRE = 4046.8564;
  var KG_PER_SHORT_TON = 907.18474;
  var SECONDS_PER_YEAR = 31557600;
  var KG_PER_LB = 0.45359237;
  var M2_PER_SQ_MI = 2589988.11;
  // Lead azide is Pb(N3)2: one lead atom (207.2) and six nitrogen atoms (14.007 each).
  var PB_SHARE_OF_LEAD_AZIDE = 207.2 / (207.2 + 6 * 14.007);   // about 0.711

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
   * Lead from a one-time detonation spread evenly over an area.
   * Returns { leadKg, escapedKg, mgM2 }.
   */
  function detonationPulse(leadAzideLb, escapeFraction, spreadSqMi) {
    var leadKg = leadAzideLb * KG_PER_LB * PB_SHARE_OF_LEAD_AZIDE;
    var escapedKg = leadKg * escapeFraction;
    return { leadKg: leadKg, escapedKg: escapedKg, mgM2: (escapedKg * 1e6) / (spreadSqMi * M2_PER_SQ_MI) };
  }

  /** How many mg/kg a deposit of mgM2 adds when mixed into a soil layer layerIn inches deep. */
  function addedPpm(mgM2, layerIn, bulkDensity) {
    var kgPerM2 = layerIn * 0.0254 * bulkDensity * 1000;
    return mgM2 / kgPerM2;
  }

  /**
   * Run the outlook for one crop.
   * opts: { C, R, K, LS, P, T, rTrend, baseYear, startYear, endYear,
   *         bulkDensity, plowLayerIn, pb0, pbSub, depositionMgM2Yr, manurePbMgKg, manureDryTonsAc,
   *         pulseMgM2, pulseYear }   (the last two are optional: a one-time lead input in one year)
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
      var yearInputsMg = inputsMg + (opts.pulseMgM2 && y === opts.pulseYear ? opts.pulseMgM2 * M2_PER_ACRE : 0);
      pb = pb + (erodedKg * (opts.pbSub - pb) + yearInputsMg) / plowKg;
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
    var pulse = null;
    if (scenario.detonation) {
      var det = li.detonation;
      pulse = detonationPulse(lead.detonation_2026.lead_azide_lb, det.escape_fraction.value, det.spread_sq_mi.value);
      pulse.year = Number(lead.detonation_2026.date.slice(0, 4));
    }

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
        manureDryTonsAc: scenario.manure ? li.manure_rate_dry_tons_ac_yr.value : 0,
        pulseMgM2: pulse ? pulse.mgM2 : 0,
        pulseYear: pulse ? pulse.year : null
      });
      out.id = crop.id;
      out.name = crop.name;
      out.C = cfg.C[settings.tillage];
      out.acres = crop.harvested_acres;
      out.statewideTons = out.totalTonsPerAcre * crop.harvested_acres;
      return out;
    });

    return { crops: results, depositionMgM2Yr: deposition, pulse: pulse, scenario: scenario, trend: trend };
  }


  // ---------- hay, cattle and ethanol pathway ----------
  // Lead that settles on standing forage: deposit × share caught ÷ forage mass. mg/m² ÷ kg/m² = mg/kg dry.
  function forageFromDeposit(depositMgM2, interception, biomassKgM2) { return depositMgM2 * interception / biomassKgM2; }
  // Rain and wind wash leaf lead off with a half-life.
  function weathered(mgKg, days, halfLifeDays) { return mgKg * Math.pow(0.5, days / halfLifeDays); }
  // Lead a plant takes up from soil plus the soil that rides along on hay.
  function forageFromSoil(soilPpm, soilToForage, soilOnHay) { return soilPpm * (soilToForage + soilOnHay); }
  // A round bale left outside catches dust only on the top it shows to the sky.
  function baleFromDeposit(depositMgM2, footprintM2, baleDryKg) { return depositMgM2 * footprintM2 / baleDryKg; }

  /** Where one cow's daily lead goes, from the lead in her feed (mg/kg dry) and the soil she eats. */
  function cowDay(dietMgKg, soilPpm, cow) {
    var intake = cow.dmiKg * dietMgKg + cow.soilKg * soilPpm;   // mg a day
    return {
      intakeMg: intake,
      manureMg: intake * (1 - cow.absorbed),
      absorbedMg: intake * cow.absorbed,
      milkMgL: intake * cow.milkPerL                           // steady state, if she ate this every day
    };
  }

  /** Corn grain lead from soil (low and high ratios), and the distillers grains made from it. Lead does not distill into the fuel. */
  function ethanolPathway(soilPpm, ratioLow, ratioHigh, ddgsFactor) {
    var lo = soilPpm * ratioLow, hi = soilPpm * ratioHigh;
    return { grainLow: lo, grainHigh: hi, ddgsLow: lo * ddgsFactor, ddgsHigh: hi * ddgsFactor, fuel: 0 };
  }

  /** Reads feed.json into the plain numbers the functions above take. */
  function feedInputs(feed) {
    var f = feed.forage, b = feed.bale, c = feed.cow;
    return {
      interception: f.interception_fraction.value, biomass: f.standing_biomass_kg_m2.value, halfLife: f.weathering_half_life_days.value,
      soilToForage: f.soil_to_forage_ratio.value, soilOnHay: f.soil_on_hay_share.value,
      baleFootprint: b.footprint_m2.value, baleKg: b.dry_matter_kg.value,
      cow: { dmiKg: c.dry_matter_intake_kg_day.value, soilKg: c.soil_eaten_kg_day.value, absorbed: c.absorbed_share.value, milkPerL: c.milk_transfer_d_per_l.value }
    };
  }

  /** One row per feeding case for a given deposit: forage lead, what a cow eats, and where it goes. */
  function hayCases(depositMgM2, soilPpm, feed) {
    var k = feedInputs(feed);
    var fromSoil = forageFromSoil(soilPpm, k.soilToForage, k.soilOnHay);
    var fresh = forageFromDeposit(depositMgM2, k.interception, k.biomass);
    var rows = [
      { id: 'day1', label: 'Grazing the day it fell', forage: fresh + fromSoil },
      { id: 'day14', label: 'Grazing two weeks later', forage: weathered(fresh, 14, k.halfLife) + fromSoil },
      { id: 'day30', label: 'Grazing a month later', forage: weathered(fresh, 30, k.halfLife) + fromSoil },
      { id: 'bale', label: 'Round bale left outside', forage: baleFromDeposit(depositMgM2, k.baleFootprint, k.baleKg) + fromSoil },
      { id: 'background', label: 'Normal hay, no fallout', forage: fromSoil }
    ];
    rows.forEach(function (r) { r.cow = cowDay(r.forage, soilPpm, k.cow); });
    return rows;
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

  var api = { PB_SHARE_OF_LEAD_AZIDE: PB_SHARE_OF_LEAD_AZIDE, tonsPerAcreInch: tonsPerAcreInch, dryDepositionMgM2Yr: dryDepositionMgM2Yr,
    detonationPulse: detonationPulse, addedPpm: addedPpm,
    forageFromDeposit: forageFromDeposit, weathered: weathered, forageFromSoil: forageFromSoil, baleFromDeposit: baleFromDeposit,
    cowDay: cowDay, ethanolPathway: ethanolPathway, feedInputs: feedInputs, hayCases: hayCases, runCrop: runCrop, runAll: runAll, parseCSV: parseCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IowaModel = api;
})(this);
