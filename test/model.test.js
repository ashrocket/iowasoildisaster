// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../model.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8');
const crops = M.parseCSV(read('crops.csv'));
const model = JSON.parse(read('model.json'));
const lead = JSON.parse(read('lead.json'));

const base = {
  C: 0.1, R: 180, K: 0.32, LS: 1, P: 1, T: 5, rTrend: 0,
  baseYear: 2025, startYear: 2026, endYear: 2035,
  bulkDensity: 1.33, plowLayerIn: 8, pb0: 23.1, pbSub: 14.9, depositionMgM2Yr: 0
};

test('one acre-inch of soil at 1.33 g/cm3 weighs about 150.7 short tons', () => {
  assert.ok(Math.abs(M.tonsPerAcreInch(1.33) - 150.7) < 0.1);
});

test('RUSLE gives R x K x LS x C x P each year when rain is steady', () => {
  const r = M.runCrop(base);
  assert.equal(r.years.length, 10);
  assert.ok(Math.abs(r.years[0].tonsPerAcre - 180 * 0.32 * 0.1) < 1e-9);
  assert.ok(Math.abs(r.totalTonsPerAcre - 10 * 5.76) < 1e-9);
});

test('a rising rain trend raises erosion every year', () => {
  const r = M.runCrop({ ...base, rTrend: 0.01 });
  for (let i = 1; i < r.years.length; i++) assert.ok(r.years[i].tonsPerAcre > r.years[i - 1].tonsPerAcre);
});

test('no cover factor means no erosion and lead only changes from inputs', () => {
  const r = M.runCrop({ ...base, C: 0 });
  assert.equal(r.totalTonsPerAcre, 0);
  assert.equal(r.pbEnd, 23.1);
});

test('lead stays put when subsoil matches topsoil and nothing is added', () => {
  const r = M.runCrop({ ...base, pbSub: 23.1 });
  assert.ok(Math.abs(r.pbEnd - 23.1) < 1e-9);
});

test('dry deposition of 0.11 ug/m3 at 0.5 cm/s is about 17.4 mg/m2/yr', () => {
  assert.ok(Math.abs(M.dryDepositionMgM2Yr(0.11, 0.5) - 17.36) < 0.01);
});

test('reduced tillage corn and soybeans land near the measured Iowa average of 4.7 to 5.2 t/ac/yr', () => {
  const r = M.runAll(crops, model, lead, { tillage: 'reduced', trendId: 'steady', scenarioId: 'background' });
  const corn = r.crops.find((c) => c.id === 'corn_grain').years[0].tonsPerAcre;
  const soy = r.crops.find((c) => c.id === 'soybeans').years[0].tonsPerAcre;
  const avg = (corn + soy) / 2;
  assert.ok(avg > 3.5 && avg < 6, `rotation average ${avg}`);
});

test('every crop in crops.csv has model settings', () => {
  for (const c of crops) assert.ok(model.crops[c.id], `missing model.crops.${c.id}`);
});

test('lead azide is about 71% lead by weight', () => {
  assert.ok(Math.abs(M.PB_SHARE_OF_LEAD_AZIDE - 0.7114) < 0.0005);
});

test('10,000 lb of lead azide, 25% escaping over 30 square miles, leaves about 10.4 mg/m2', () => {
  const p = M.detonationPulse(10000, 0.25, 30);
  assert.ok(Math.abs(p.leadKg - 3227) < 2, `lead ${p.leadKg}`);
  assert.ok(Math.abs(p.mgM2 - 10.38) < 0.02, `pulse ${p.mgM2}`);
});

test('a one-time pulse raises plow layer lead once, by pulse / layer mass', () => {
  const r = M.runCrop({ ...base, C: 0, pulseMgM2: 10.38, pulseYear: 2026 });
  const added = M.addedPpm(10.38, 8, 1.33);
  assert.ok(Math.abs(r.years[0].pb - (23.1 + added)) < 1e-9);
  assert.ok(Math.abs(r.pbEnd - r.years[0].pb) < 1e-9);
});

test('the detonation scenario runs and adds its pulse in 2026', () => {
  const r = M.runAll(crops, model, lead, { tillage: 'reduced', trendId: 'steady', scenarioId: 'detonation' });
  assert.ok(r.pulse && r.pulse.year === 2026 && r.pulse.mgM2 > 0);
});

const feed = require('../data/feed.json');

test('fallout on standing forage is deposit times share caught over forage mass', () => {
  assert.ok(Math.abs(M.forageFromDeposit(10, 0.5, 0.24) - 20.833) < 0.01);
  assert.ok(Math.abs(M.weathered(20, 14, 14) - 10) < 1e-9);
});

test('a cow on fresh fallout pasture eats about 300 mg a day and 96% leaves in manure', () => {
  const rows = M.hayCases(10.38, 23.1, feed);
  const day1 = rows.find((r) => r.id === 'day1');
  assert.ok(day1.forage > 23 && day1.forage < 25, day1.forage);
  assert.ok(day1.cow.intakeMg > 280 && day1.cow.intakeMg < 310, day1.cow.intakeMg);
  assert.ok(Math.abs(day1.cow.manureMg / day1.cow.intakeMg - 0.96) < 1e-9);
  const bg = rows.find((r) => r.id === 'background');
  assert.ok(bg.forage < day1.forage && bg.forage > 2 && bg.forage < 2.5);
});

test('ethanol fuel carries no lead and distillers grains hold about 3 times the grain', () => {
  const e = M.ethanolPathway(23.1, 0.001, 0.003, 3);
  assert.equal(e.fuel, 0);
  assert.ok(Math.abs(e.ddgsHigh - 23.1 * 0.003 * 3) < 1e-9);
});
