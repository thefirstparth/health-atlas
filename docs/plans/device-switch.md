# Plan: switching devices (Apple Watch → Fitbit Air), without losing the long view

Status: **Phase 1 built and tested on synthetic data** (branch `claude/awesome-gates-f3dvqg`, not on
main). It still needs checking against a real export once the Fitbit Air is in use. Phase 2 waits for
a real Google Takeout export.

Built differently from the first draft below: device eras come from the dominant **heart rate**
source per day (not per measure per month), with runs under 14 days folded into their neighbours,
and stored as `meta.devices = [{ name, from, to }]`.

## The situation

- Google Health (the renamed Fitbit app) writes to Apple Health since version 5.05 (Aug 2026):
  steps, distance, floors, active calories, workouts, sleep with stages, heart rate, resting heart
  rate, respiratory rate, blood oxygen, VO₂ max.
- It does **not** write HRV or skin temperature. Fitbit measures HRV as RMSSD; Apple Health only
  has an SDNN type, so Google leaves it out rather than mislabel it.
- There will be **no overlap** (both devices worn at once), so no direct way to measure how
  differently the two devices read. Any jump on the switch day cannot be split into "real change"
  and "device difference". The app must show the switch, not hide it.

## Principles

1. **It works for everyone, automatically.** No "I switched devices" setting is needed: the
   export already names the source of every record ("Parth's Apple Watch", "Google Health"...).
   Someone who only ever wore an Apple Watch sees no change at all.
2. **Never splice two devices into one line as if they were one.** Show both, mark the switch,
   and keep comparisons, records and "usual" within one device.
3. **Never put one measure in another's slot.** Fitbit HRV (RMSSD) is its own series, never
   written into the Apple HRV (SDNN) one.
4. **Same parity rule as today.** Parser changes are mirrored in `test/reference/parse_health.py`,
   value for value.

## Phase 1: one Apple Health export, both devices in it (needed on switch day)

The Apple Health export will hold both eras. Today, three rules in the parser break the Fitbit era:

| Gap | Today | Change |
| --- | --- | --- |
| Sleep | Apple Watch sleep is used for the whole export if any exists, so every Fitbit night is dropped | Choose the source **per night**: Apple Watch when that night has it, otherwise the best other staged source |
| Active energy | Read only from Apple's Activity ring totals, which need a Watch | On days with no ring total, use `ActiveEnergyBurned` readings, highest source per hour, like steps |
| Exercise minutes, stand hours, daylight, environmental sound | Watch-only | Keep as is; the chapter says "Not recorded since you stopped using an Apple Watch on …" instead of a silent gap |

Plus the switch itself:

- **Detect device eras** from record sources: for each measure, the dominant source per month,
  and the date it changes. Store as `meta.devices = [{ name, from, to, measures }]`.
- **Draw the switch** on every affected chart: a vertical line labelled "Fitbit Air from Oct 20".
  Trend lines break there instead of smoothing across it.
- **Comparisons stay within a device.** "vs the 30 days before", "usual", records, streaks and
  year-on-year facts only compare days from the same device. Where that leaves too few days, the
  card says why ("Fitbit Air data starts Oct 20; comparisons resume after 4 weeks").
- **Settings lists the devices** and their date ranges, so it's visible what is being read.

Tests: a new fixture in `test/make_fixtures.py` with ~200 days of Watch data, then ~60 days of
"Google Health" data (sleep stages, active energy, RHR, no HRV). Parity, upload cases and the
layout audit must all pass.

## Phase 2: keeping HRV (and anything else Apple Health won't get) continuous

Two routes, both explicit:

- **Fitbit export as a second file for the same person.** Settings → "Add a Fitbit export",
  next to "Add a newer export". It is merged into your timeline (not a comparison), adding only
  what Apple Health lacks: nightly HRV (RMSSD), skin temperature, maybe Active Zone Minutes.
  Everything Apple Health already has keeps the Apple Health copy, so nothing is counted twice.
  *First step:* inspect one real Google Takeout export. Third-party guides disagree on its format
  (JSON vs CSV, where HRV lives), so the importer is written against a real file, not a guess.
- **HRV against your own normal.** Alongside the raw lines, a view of each night as % above or
  below that device's own 60-day baseline. Both eras then read on one scale. Without overlap this
  is the honest way to follow HRV over years: direction and size of change, not one absolute
  number. The baseline needs about 4 weeks of Fitbit data before it shows.

## Phase 3 (optional)

- Per-device "usual" in the Overview ("Last 7 days against your usual" uses Fitbit weeks only once
  there are 8 of them).
- Compare mode benefits for free: a friend on Fitbit gets sleep and active energy too.

## What to do on your side before switching

1. Keep the Apple Watch on until the day you switch, then **export Apple Health once** and save the
   `.json` copy from Settings. That freezes the Watch years.
2. Install Google Health and turn on **Connections → Apps and services → Apple Health**.
3. Keep carrying the iPhone: walking speed, step length and steadiness come from it.
4. After 2–3 weeks on the Air, export Apple Health again and request a Google Takeout of Fitbit.
   Those two files are what Phase 1 and 2 get built and tested against.
