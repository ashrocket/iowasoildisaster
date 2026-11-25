# Contributing

Corrections and additions are welcome as pull requests. Most changes touch only the `data/` folder and can be made in the browser on GitHub.

## Fix a number

1. Open the file on GitHub and press the pencil icon:
   - `data/crops.csv` for USDA crop figures
   - `data/farms.json` for farm and livestock counts
   - `data/weather.json` for climate figures
   - `data/lead.json` for lead measurements and limits
   - `data/model.json` for model inputs
   - `data/feed.json` for the hay, cattle and ethanol pathway
   - `data/counties.csv` for the counties near the Nov 25 detonation
2. Change the value. Keep the units the file already uses.
3. Make sure its `source` field names an entry in `data/sources.json`. If your source is new, add it there with an `id`, `title`, `publisher`, `url` (https) and `accessed` date.
4. Commit to a new branch and open a pull request. Fill in the template: what changed, why, and the link.

## Replace an assumption

Values with `"source": "assumption"` are placeholders the model needs. They are the most useful things to improve. Good candidates:

- Iowa-measured C factors for corn silage, oats and hay
- Iowa's own deep-soil (12 to 24 inch) lead figures from the Iowa Geological Survey's 2003 sampling, to replace the national subsoil value
- A current rural Iowa lead deposition rate
- Typical manure application rates on Iowa cropland
- Measured lead from the Nov 25, 2026 detonation: EPA or Army air, soil and wipe sampling results, which should replace the share leaving the plant and the fallout area in `data/model.json`
- Forage, hay, milk or distillers grains sampling from the fallout area, which should replace the estimates in `data/feed.json`
- The names of the counties holding the roughly 350 farms USDA says are in the plume

## Add a crop

Add a row to `data/crops.csv` and a matching entry under `crops` in `data/model.json` with C factors for `conventional`, `reduced` and `notill`, a `source` and a `color` (one of `corn`, `soy`, `hay`, `oats`, `silage`).

## Change the model or the page

`model.js` holds the calculations and `test/model.test.js` the tests. Run `npm test` before opening the pull request, and explain the change in plain words in the description.

## Checks

Every pull request runs `node scripts/validate.js` and `node --test`. The check fails if a file is not valid JSON or CSV, a number is not a number, a `source` names an unknown id, or a crop has no C factors.

## Ground rules

- Cite public sources. No private or unpublished data.
- Label estimates as estimates. Don't state health effects the data doesn't support.
