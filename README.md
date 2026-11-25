# Iowa Soil Ledger

Iowa's 2025 crops, the lead in its soil and air, and the weather that moves its soil, laid out on one zoomable canvas, with a ten-year outlook (2026 to 2035) of how much topsoil each crop could lose.

Every number comes from a public source listed in `data/sources.json`, or is marked as an **assumption** that the model needs. Projections are estimates from a simple model, not measurements.

## Run it locally

The page loads its data with `fetch`, so open it through a small web server rather than as a file:

```
npx serve .
```

Then open the address it prints. There is no build step and no dependencies.

```
npm test
```

runs the data check (`scripts/validate.js`) and the model tests (`test/model.test.js`).

## What is in the repository

| Path | What it holds |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The canvas page: layout, pan and zoom, cards and charts |
| `model.js` | The model. Plain JavaScript, used by the page and by the tests |
| `data/crops.csv` | USDA NASS 2025 Iowa crop table: acres, yield, production, price, value |
| `data/farms.json` | Farm count, acres and livestock inventory |
| `data/weather.json` | NOAA climate summary figures and the rainfall erosivity range |
| `data/lead.json` | Soil lead survey, EPA soil levels, the Council Bluffs air monitor, deposition and manure figures |
| `data/model.json` | Every model input, each with its source id |
| `data/sources.json` | The source list. Every `source` field must name an id here |
| `data/site.json` | The GitHub `owner/name`, used for the page's edit buttons |

## How the outlook is calculated

The model runs once a year from 2026 to 2035 for an average acre of each crop.

**Erosion** uses the Revised Universal Soil Loss Equation:

```
A = R × K × LS × C × P        tons of soil per acre per year
R_year = R × (1 + trend)^(year − 2025)
```

- `R` rainfall erosivity: 180, the middle of Iowa's 160 to 200 range (ISU, 1967).
- `K` soil erodibility: 0.32, Tama silty clay loam (ISU, 1967).
- `LS` slope: 1.0, an assumption chosen so a corn and soybean rotation under reduced tillage lands near Iowa's measured 4.7 to 5.2 tons/acre/yr. Adjustable on the page.
- `C` crop cover: per crop and tillage. Corn and soybean values come from Alberts et al. (1985). Silage, oats and hay are assumptions.
- `P` practice: 1.0, no contouring or terraces.
- `trend`: how fast rain intensity grows. 0, 0.5% or 1% a year. NOAA reports more 2-inch rain days but gives no erosivity trend, so this is a scenario, not a forecast.

Topsoil depth lost = tons ÷ tons in one acre-inch (150.7 at a bulk density of 1.33 g/cm³). Each year is compared with the soil loss tolerance `T` of 5 tons/acre/yr.

**Lead** uses a mass balance on the 8-inch plow layer of one acre:

```
c_next = c + (E × (c_sub − c) + I) / M
```

- `c` starts at 23.1 mg/kg, the mean of 91 Iowa surface samples (USGS via EPA).
- `E` is the eroded soil mass. It leaves with its lead, and the same mass of subsoil at `c_sub` = 14.9 mg/kg (US C horizon median) mixes in from below.
- `I` is lead added by air and manure. Air deposition is `concentration × deposition speed`. The "Beside the Council Bluffs monitor" scenario uses the monitor's 0.11 µg/m³ design value and an assumed 0.5 cm/s.
- `M` is the plow layer mass.

The model leaves out gullies, wind erosion, tile drainage, rotations within a field, yield effects and plant uptake. It is for comparing crops and practices, not predicting a given field.

## Corrections and additions

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: edit the file in `data/`, point the value at a source, and open a pull request. A check runs on every pull request, and the site republishes when it is merged.

## Publishing

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. Turn on Pages for the repository (Settings, Pages, Source: GitHub Actions) and set `repo` in `data/site.json`.
