# Health Atlas

Built by Parth Bhatia (https://bhatia.page).

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
| `src/vault.js` | Opens a health vault: reads the repo zip or `.vault` files, decrypts them, lays the wearable's days after the Apple export |
| `src/compare.js` | Compare mode: two or three people on one timeline, built from the dashboard's own chart helpers |
| `src/icons.js` | The chapter line icons, shared by the dashboard and the home page |
| `src/sample.js` | Sample data for the demo (`?demo`), the compare demo (`?demo=compare`), the device-switch demo (`?demo=switch`), the health vault demo (`?demo=vault`) and the home page. Made up, never stored |
| `src/landing.js` | Home page: the sleep recorder figure, the zoom-out story, chapters and the live demo |
| `assets/fonts/` | Figtree (text), Newsreader (headlines) and IBM Plex Mono (labels), self-hosted under the OFL |
| `vercel.json` | Security headers (CSP and others) for every path |

No build step and no dependencies. What is in the repo is what is served.

### Aggregation rules

These are the same as the reference parser in `test/reference/parse_health.py`:

- Cumulative measures (steps, distance, flights, daylight, resting energy) take the highest single source per hour, then add up the hours, so the Watch and iPhone are not double counted.
- Rings come from Apple's daily Activity summaries. On days with no Watch ring (another wearable, or only an iPhone), active energy comes from the `ActiveEnergyBurned` readings instead, highest source per hour.
- Sleep is chosen per night: Apple Watch stages when that night has them, otherwise the other source with the most sleep that night. A night is dated by the day you woke up.
- Times are the local clock time written on each record.
- Impossible dates are left out, and Settings says so: anything after the export date or before 2000, and a small cluster of days (under 60, and under 5% of all days) cut off from the rest by a gap of a year or more. A single record with a wrong clock would otherwise stretch the timeline back decades. This runs after the parser, so parity with the reference is unaffected, and also on data already saved in the browser.

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

## Compare with friends

Open two or three exports at once ("Comparing with friends?" on the home page, **Compare with friends** in Settings, or drop several files) and give each one a name. Each file is read on the device by the same worker, one after another; your own stored data can be one of the people. A sample comparison of three made-up people is at `?demo=compare`.

How the comparison is drawn:

- **One colour per person, everywhere.** Blue, orange and aqua, checked for colour-vision deficiency against both the light and dark card colours. Colour is never the only cue: every line ends in the person's name and every chart has a legend.
- **Simple measures share one chart.** Steps, heart rate, sleep length and the rest show one trend line per person (Week view shows each day side by side instead). The rail beside the chart ranks people, says in one sentence who is ahead and by how much, and shows how many days each average rests on. A strip under the chart marks who did better in each week, month or year.
- **Composite charts get a row or column per person.** Sleep schedule (one bar per person), every night bed to wake (one column per person, rows aligned by date) and sleep stages (one 100% bar per person) would tangle if overlaid.
- **Body is left out.** Weight and blood pressure are personal and not a fair comparison.

Missing data:

- Everyone is laid on one timeline, from the earliest start to the latest end. Days outside someone's export are empty, never zero, so their line simply stops.
- The first view ends on the last day everyone has data, so the opening comparison is fair.
- When someone has nothing for a period the reason is shown: export starts later, export ends earlier, or not recorded (an iPhone without a Watch has no sleep, heart or workouts).
- An average resting on under half of the days in the period is marked in red.
- **Days everyone recorded** narrows every daily measure to days that all visible people have it, so nobody is averaged over a different set of days. A measure only one person records is left as it is.
- People can be hidden with their chip; colours never move.

The same export added twice is refused, names must differ, and friends' exports stay in this browser until **End comparison** or **Forget my data**.

## Changing devices

Moving from an Apple Watch to another wearable that writes to Apple Health (for example Fitbit through the Google Health app) keeps one timeline. Nothing needs setting up: the export names the source of every heart rate reading, so the device behind each day is known. Someone who only ever wore one device sees no change.

- **Device eras.** The device that wrote the most heart rate readings each day; a run shorter than 14 days (7 at the very end) is folded into its neighbours, so a borrowed Watch for a weekend is not a switch. Settings lists the devices and their dates.
- **The switch is drawn, not hidden.** Charts of measures that depend on the wearable show a dashed line labelled "Fitbit from Sep 17", and trend lines break there. Two devices read differently and there is no overlap to measure by how much, so a jump on that day cannot be split into real change and device difference.
- **Comparisons stay within one device.** "vs the 30 days before", records, streaks, "usual", year-on-year facts and the range gauge only use days from the current device; where the window crosses the switch the card says **New device** or **Not compared** instead.
- **Measures the new device does not send** (exercise minutes, stand hours, HRV, daylight, sound on a Fitbit) say "Not recorded since you switched to Fitbit on …" instead of a silent gap.
- **iPhone measures are not affected:** walking speed, step length, steadiness, stairs, the six-minute walk, headphone audio and Body measures carry on across the switch.

A sample switch is at `?demo=switch`. The full plan, including keeping HRV continuous from a Fitbit export, is in `docs/plans/device-switch.md`.

## Irregular rhythm notifications

AFib notifications from an Apple Watch (and from a vault's band) have their own card in Heart, shown only to people who have ever had one. A period without any says so ("No irregular rhythm notifications in this period"): none is good news, not missing data.

## Health vault

A health vault is a private GitHub repo that a GitHub Action fills twice a day from the Google Health API (a Fitbit, or any device Google Health reads), with the weather and air around each day, all encrypted with a passphrase. It can also hold a frozen Health Atlas copy of an Apple Health export (`apple-watch.vault`), so the Apple Watch years and the new wearable sit on one timeline.

Open it with **Keep a health vault? Open it** on the home page, or **Open your health vault** in Settings: choose the repo's zip (GitHub: *Code → Download ZIP*) or its `.vault` files and type the passphrase. Decryption happens in the worker, on this device; the passphrase is not kept. Without an `apple-watch.vault`, the vault's days are added to what the browser already holds. Open it again for newer days. A sample is at `?demo=vault`.

What it adds, only for datasets that have it (nobody else sees these, not even as "not recorded"):

- **Heart rate variability**: one card for both devices. The Apple Watch's HRV (SDNN) and Fitbit's (RMSSD, during sleep) are different measures, so each is drawn in its own colour, the line breaks at the switch, and the card's numbers and its 30-day average use only the device worn now. The two series stay separate in the data (`hrv`, `hrvRmssd`); the Overview board keeps an "HRV (Fitbit)" row.
- **Exercise minutes**: the same treatment for the Apple Watch's exercise minutes and Fitbit's **Active Zone Minutes** (minutes in its fat-burn, cardio and peak zones): one card, two colours, never compared. The data keeps `exercise` and `azm` apart; the Overview board and the Activity summary show Active Zone Minutes.
- **HRV against your normal**: each night's HRV as a percentage above or below the median of the 60 nights before it, on the same device only, from 14 nights in. The one HRV line that runs across a change of device.
- **Skin temperature** (against Google's baseline), **blood oxygen**, Fitbit workouts, sleep stages (Fitbit's light sleep is shown as core).
- What the existing charts need to carry on after the switch: the day's **heart-rate range** (low, average, high), **active energy**, **resting energy** (Google's total calories for the day minus active energy), and **irregular rhythm (AFib) notifications**.
- **Air and weather where you live**: PM2.5 and outdoor temperature over the hours you slept (from the band's sleep times), the day's worst hour on the US AQI, the day's high. City-scale model estimates, not room sensors.

Rules: the Fitbit era starts on the first day the band recorded its own readings (Google's VO₂ max estimate is labelled Fitbit even before, so it does not count, and is kept weekly or when it changes). Google's copies of Apple Health data (`HEALTH_KIT`) are ignored. On days both have, the vault wins.

## Dashboard 1.1

Small changes that make the charts easier to read, with the design system unchanged:

- Duration axes step in clock-friendly units (15 min, 30 min, 1 hr, 2 hr) and read "1h20", never "80m" above "1h".
- Faint weekly and monthly bars keep the chapter colour; the trend line turns red below target. Pale red next to pale orange was hard to tell apart and made charts look striped. Solid single-day bars in Week view still turn red.
- Large axis values read 15k, 10k, 5k, like the strip under the chart.
- The sleep schedule axis hugs the data to the hour instead of starting hours early.
- Days still to come in the rings calendar show only their date, not empty rings.
- "Needs attention" says its shortfall adds up only the days under target, so it no longer seems to contradict an average above target.
- Rails say what the arrows compare against, and the Workouts header no longer mentions a trend line it does not draw.

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
node test/compare_flow.cjs test/fixtures                # compare: naming, reading, reload, rename, bad and duplicate files, end
node test/trim_timeline.mjs                             # impossible dates (1939, after the export, stray clusters) are left out
node test/device_switch.cjs test/fixtures               # Apple Watch -> Fitbit in one export: eras, sleep and energy kept, switch drawn
node test/make_vault.mjs test/fixtures                  # a made-up health vault (repo zip, passphrase "correct horse battery staple")
node test/vault_import.mjs test/fixtures                # opening it without a browser: every rule above
node test/vault_flow.cjs test/fixtures                  # opening it through the UI: wrong passphrase, chapters, Settings, reload, people without one
COMPARE=1 node test/layout_audit_app.cjs /tmp/d.json    # the layout audit, walking compare mode (sample people)
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
