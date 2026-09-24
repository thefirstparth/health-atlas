# Health Atlas

See years of your Apple Health export as clear charts: sleep, heart, stress and recovery, activity, workouts, mobility, environment and body, by week, month, 6 months, year and all time.

The site runs entirely in your browser. You choose your `export.zip`, the page reads it on your device, and the result is kept in the browser's own storage. There is no server code, no account, no analytics, and a Content-Security-Policy with `connect-src 'none'` stops the page from making any network request.

## How it works

| File | Role |
| --- | --- |
| `index.html` | Landing, processing and dashboard views, settings sheet |
| `src/app.js` | App shell: file choice, drag and drop, IndexedDB, settings, forget |
| `src/worker.js` | Web Worker that runs the parser off the main thread |
| `src/parser.js` | Streaming unzip (native `DecompressionStream`) and a hand-written XML tokenizer. Never resolves DTD entities. Keeps about 30 MB in memory for an 800 MB `export.xml` |
| `src/validate.js` | Structural check for stored data and imported `.json` copies |
| `src/dashboard.js` | The dashboard (overview rules, charts, scrubbing, tapestry, calendars, records, poster) |
| `src/icons.js` | The chapter line icons, shared by the dashboard and the home page |
| `src/sample.js` | Sample data for the demo (`?demo`) and the home page. Made up, never stored |
| `src/landing.js` | Home page: the sleep recorder figure, the zoom-out story, chapters and the live demo |
| `assets/fonts/` | Figtree (text), Newsreader (headlines) and IBM Plex Mono (labels), self-hosted under the OFL |
| `vercel.json` | Security headers (CSP and others) for every path |

No build step and no dependencies. What is in the repo is what is served.

### Aggregation rules

These are the same as the reference parser in `test/reference/parse_health.py`:

- Cumulative measures (steps, distance, flights, daylight, resting energy) take the highest single source per hour, then add up the hours, so the Watch and iPhone are not double counted.
- Rings come from Apple's daily Activity summaries.
- Sleep uses Apple Watch stages, with other sleep apps used only when there is no Watch sleep at all. A night is dated by the day you woke up.
- Times are the local clock time written on each record.

### Overview rules

The Overview shows counts, averages and comparisons only. Nothing is estimated or scored.

- **Last 7 days against your usual.** For each measure, the average of the last 7 days is placed against the weekly averages of the 26 weeks before. "Usual" is the middle half of those weeks. A week needs at least 4 recorded days.
- **Worth knowing.** Up to six facts, chosen by fixed rules and ranked by how uncommon they are:
  - a 7-day average higher or lower than every week for at least 12 weeks;
  - an all-time daily record set in the last 7 days;
  - a run of days on target of 7 or more that is your longest, or 14 or more;
  - the last 30 days against the same 30 days a year earlier, when the gap is larger than 1.2 standard deviations of your 30-day averages;
  - a workout type returning after 60 days or more;
  - 2 or more days with no data in the last 7.
- **Targets.** The last 8 weeks against the targets in Settings.
- **Your week, by weekday.** Averages for each weekday over the last 12 weeks.

## Run locally

```sh
node tools/serve.mjs 8123      # serves with the same headers as vercel.json
open http://localhost:8123
```

Browsers supported: current Safari (iOS/macOS 16.4+), Chrome, Edge and Firefox. It needs `DecompressionStream('deflate-raw')` and module workers.

## Tests

The tests need Node 22+ and Playwright. Parity also needs Python 3 with `lxml`.

```sh
python3 test/make_fixtures.py test/fixtures             # synthetic exports (made-up values)
sh test/parity.sh test/fixtures/watch.zip               # JS parser == Python reference, value for value
sh test/parity.sh /path/to/your/export.zip              # same, on a real export (stays local)
node test/upload_cases.cjs                              # every fixture through the real UI, including bad files
node test/e2e.cjs /path/to/export.zip                   # offline read, settings, reload, forget
node test/run-node.mjs test/fixtures/watch.zip /tmp/d.json && node test/layout_audit_app.cjs /tmp/d.json metric
node test/homepage_qa.cjs /tmp/hpqa                     # home page: automated checks + screenshots, 4 widths x 2 themes
node test/dashboard_qa.cjs /tmp/d.json /tmp/dqa         # dashboard's newer pieces: screenshots for a visual pass
node test/demo_flow.cjs                                 # sample data is never stored and never replaces real data
```

`layout_audit_app.cjs` walks every view, recent year and chapter at four widths in light and dark mode, and must report `0` issues before deploying.

## Editing the dashboard

`src/dashboard.js` and `assets/dashboard.css` are the dashboard source. They started as a fork of the standalone single-file dashboard and now carry the web-only features: linked scrubbing, the period zoom, the sleep tapestry, calendar grids, chapter vital signs, records and the share poster. `src/sample.js` generates the made-up person used by the demo and the home page.

## Deploy on Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Other**. Leave the build command empty. Output directory: `.` (the repository root).
4. Deploy. `vercel.json` applies the security headers. `.vercelignore` keeps `test/` and `tools/` off the site.

After deploying, check that the headers are live with `curl -sI https://<your-domain>/ | grep -i content-security`. Then on an iPhone, load the site, turn on Airplane Mode and open an export.

## Privacy and data

- `.gitignore` excludes exports, datasets and saved copies. Never commit real health data. Test fixtures are synthetic and generated locally.
- Date of birth and sex are read by the parser but deleted before anything is stored.
- See `privacy.html` for the user-facing explanation.

Not medical advice. Not affiliated with Apple.
