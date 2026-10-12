// A made-up health vault, packed the way GitHub's "Download ZIP" packs the vault repo:
//   node test/make_vault.mjs <fixtures dir>      (needs watch.zip there: python3 test/make_fixtures.py <dir>)
// Writes vault-repo.zip (an Apple Watch export as apple-watch.vault, then 40 Fitbit days in monthly files, with
// weather and air for the last 92 days) and vault-only.zip (the same months, no Apple export).
// Passphrase: "correct horse battery staple". Also writes the plain month files' days to vault-days.json for tests.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseExport } from '../src/parser.js';
import { seal } from '../src/vault.js';

const DIR = resolve(process.argv[2] || 'test/fixtures'), PASS = 'correct horse battery staple';
const T = s => Date.parse(s + 'T00:00:00Z'), addDays = (s, n) => new Date(T(s) + n * 864e5).toISOString().slice(0, 10);
const civil = d => ({ year: +d.slice(0, 4), month: +d.slice(5, 7), day: +d.slice(8, 10) });
const IST = '19800s', ist = (d, hhmm) => new Date(Date.parse(`${d}T${hhmm}:00+05:30`)).toISOString().replace('.000Z', 'Z');
const FB = { _src: 'Fitbit Air', _platform: 'FITBIT' }, HK = { _src: "Sam's Apple Watch", _platform: 'HEALTH_KIT' };

const base = await parseExport(new Blob([await readFile(join(DIR, 'watch.zip'))]), { isZip: true, generated: '2025-10-01 09:00' });
delete base.meta.dob; delete base.meta.sex;
const fitFrom = addDays(base.meta.end, 1), fitDays = 40, last = addDays(fitFrom, fitDays - 1);

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const days = {};
for (let d = addDays(last, -91); d <= last; d = addDays(d, 1)) {
  const rec = { date: d, g: {}, ctx: {
    weather: { tMax: 29 + Math.round(rnd() * 30) / 10, tMin: 19.5, rain: 0, daylight: 715, sunshine: 650, uvMax: 8.8, nightT: 21 + Math.round(rnd() * 10) / 10, nightRH: 88 },
    air: { pm25: 18 + Math.round(rnd() * 100) / 10, pm10: 30, aqiMax: 70 + Math.round(rnd() * 40), nightPm25: 15 + Math.round(rnd() * 150) / 10 },
  } };
  if (d < fitFrom) {
    // the first sync also brought Google's copies of Apple Health: they must be ignored
    if (d > addDays(fitFrom, -10)) rec.g['daily-heart-rate-variability'] = [{ averageHeartRateVariabilityMilliseconds: 75, ...HK }];
    // Google's VO₂ max estimate is labelled FITBIT even before the band was worn
    rec.g['daily-vo2-max'] = [{ vo2Max: 44.5, cardioFitnessLevel: 'GOOD', ...FB }];
    rec.g.steps = { countSum: String(9000) };
  } else {
    const i = Math.round((T(d) - T(fitFrom)) / 864e5), prev = addDays(d, -1);
    const st = (type, a, b) => ({ type, startTime: a, startUtcOffset: IST, endTime: b, endUtcOffset: IST });
    rec.g['daily-heart-rate-variability'] = [{ averageHeartRateVariabilityMilliseconds: 38 + (i % 5), deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 44, entropy: 2.4, nonRemHeartRateBeatsPerMinute: '55', ...FB }];
    rec.g['daily-resting-heart-rate'] = [{ beatsPerMinute: String(57 + (i % 3)), dailyRestingHeartRateMetadata: { calculationMethod: 'WITH_SLEEP' }, ...FB }];
    rec.g['daily-respiratory-rate'] = [{ breathsPerMinute: i ? Math.round((14.2 + rnd() * 0.9) * 10) / 10 : 14.6, ...FB }, { breathsPerMinute: 16.1, ...HK }];
    rec.g['daily-oxygen-saturation'] = [{ averagePercentage: i ? Math.round((95.6 + rnd() * 1.4) * 10) / 10 : 96.2, lowerBoundPercentage: 93, upperBoundPercentage: 98, ...FB }];
    rec.g['daily-sleep-temperature-derivations'] = [i < 3 ? { nightlyTemperatureCelsius: 34.4, ...FB } : { nightlyTemperatureCelsius: 34.4 + (i % 4) * 0.1, baselineTemperatureCelsius: 34.5, relativeNightlyStddev30dCelsius: 0.2, ...FB }];
    rec.g['daily-vo2-max'] = [{ vo2Max: 45.1, cardioFitnessLevel: 'GOOD', vo2MaxCovariance: 1.2, ...FB }];
    rec.g.sleep = [{
      type: 'STAGES', interval: { startTime: ist(prev, '23:20'), startUtcOffset: IST, endTime: ist(d, '06:50'), endUtcOffset: IST },
      metadata: { mainSleep: true, processed: true }, _id: 's' + d, ...FB,
      stages: [st('AWAKE', ist(prev, '23:20'), ist(prev, '23:30')), st('LIGHT', ist(prev, '23:30'), ist(d, '01:00')), st('DEEP', ist(d, '01:00'), ist(d, '02:10')),
        st('REM', ist(d, '02:10'), ist(d, '03:40')), st('LIGHT', ist(d, '03:40'), ist(d, '06:40')), st('AWAKE', ist(d, '06:40'), ist(d, '06:50'))],
    }];
    if (i % 7 === 3) rec.g.sleep.push({ type: 'CLASSIC', interval: { startTime: ist(d, '15:00'), startUtcOffset: IST, endTime: ist(d, '15:40'), endUtcOffset: IST }, metadata: { mainSleep: false }, stages: [], ...FB });
    if (i % 4 === 1) rec.g.exercise = [{ exerciseType: 'RUNNING', displayName: 'Run', interval: { startTime: ist(d, '18:30'), startUtcOffset: IST, endTime: ist(d, '19:10'), endUtcOffset: IST },
      activeDuration: '2400s', metricsSummary: { caloriesKcal: 410.5, distanceMillimeters: 6543000, averageHeartRateBeatsPerMinute: '152' }, ...FB }];
    rec.g.steps = { countSum: String(7000 + i * 25) };
    rec.g.distance = { millimetersSum: String(5200000 + i * 1000) };
    rec.g['active-zone-minutes'] = { sumInFatBurnHeartZone: '12', sumInCardioHeartZone: '6', sumInPeakHeartZone: '1' };
    rec.g['total-calories'] = { kcalSum: 2310.5 };
  }
  days[d] = rec;
}

const months = {};
for (const [d, rec] of Object.entries(days)) (months[d.slice(0, 7)] ||= { v: 1, days: {} }).days[d] = rec;
const work = join(DIR, 'vault-work'); await rm(work, { recursive: true, force: true });
const pack = async (name, withApple) => {
  const root = join(work, name, 'health-vault-main'), vdir = join(root, 'vault');
  await mkdir(vdir, { recursive: true });
  await writeFile(join(root, 'README.md'), '# health-vault\n');
  for (const [ym, m] of Object.entries(months)) await writeFile(join(vdir, `${ym}.vault`), await seal(m, PASS));
  if (withApple) await writeFile(join(vdir, 'apple-watch.vault'), await seal({ kind: 'health-atlas', v: 1, sealedAt: '2025-10-01T09:00:00Z', data: base }, PASS));
  // zip like GitHub: one top folder, deflated entries
  execFileSync('python3', ['-c', `import zipfile,os,sys
src,out=sys.argv[1],sys.argv[2]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for r,_,fs in os.walk(src):
    for f in sorted(fs): p=os.path.join(r,f); z.write(p,os.path.relpath(p,os.path.dirname(src)))`, root, join(DIR, `${name}.zip`)]);
};
await pack('vault-repo', true);
await pack('vault-only', false);
await writeFile(join(DIR, 'vault-days.json'), JSON.stringify({ fitFrom, last, base: { start: base.meta.start, end: base.meta.end } }));
await rm(work, { recursive: true, force: true });
console.log(`vault-repo.zip and vault-only.zip: Apple export ${base.meta.start} … ${base.meta.end}, Fitbit ${fitFrom} … ${last}`);
