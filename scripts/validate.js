// Checks the data files before a pull request is merged. Run with: node scripts/validate.js
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV } = require('../model.js');

const dir = path.join(__dirname, '..', 'data');
const errors = [];
const readJSON = (f) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { errors.push(`${f}: not valid JSON (${e.message})`); return null; }
};

const sources = readJSON('sources.json') || [];
const ids = new Set(sources.map((s) => s.id));
sources.forEach((s, i) => {
  if (!s.id || !s.title) errors.push(`sources.json[${i}]: needs id and title`);
  if (s.id !== 'assumption' && !/^https:\/\//.test(s.url || '')) errors.push(`sources.json ${s.id}: url must start with https://`);
});

// Every "source" field anywhere in the data must name a known source id.
const walk = (node, where) => {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'source' || k.endsWith('_source')) && typeof v === 'string' && !ids.has(v)) errors.push(`${where}.${k}: unknown source "${v}"`);
      walk(v, `${where}.${k}`);
    }
  }
};
for (const f of ['model.json', 'lead.json', 'weather.json', 'farms.json']) {
  const j = readJSON(f);
  if (j) walk(j, f);
}

const crops = parseCSV(fs.readFileSync(path.join(dir, 'crops.csv'), 'utf8'));
const model = readJSON('model.json');
const numeric = ['harvested_acres', 'planted_acres', 'yield', 'production', 'price', 'value_usd', 'year'];
crops.forEach((c) => {
  if (!c.id || !c.name) errors.push(`crops.csv: every row needs id and name`);
  numeric.forEach((k) => { if (c[k] !== null && typeof c[k] !== 'number') errors.push(`crops.csv ${c.id}.${k}: "${c[k]}" is not a number`); });
  if (!ids.has(c.source)) errors.push(`crops.csv ${c.id}: unknown source "${c.source}"`);
  if (model && !model.crops[c.id]) errors.push(`crops.csv ${c.id}: add C factors for it in model.json`);
});
if (model) {
  for (const [id, cfg] of Object.entries(model.crops)) {
    for (const t of ['conventional', 'reduced', 'notill']) {
      const v = cfg.C && cfg.C[t];
      if (typeof v !== 'number' || v < 0 || v > 1) errors.push(`model.json crops.${id}.C.${t}: must be a number from 0 to 1`);
    }
  }
}

if (errors.length) {
  console.error('Data check failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`Data check passed: ${crops.length} crops, ${sources.length} sources.`);
