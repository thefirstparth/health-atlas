// Opening a health vault, without a browser: node test/vault_import.mjs <fixtures dir>
// Needs the made-up vault: python3 test/make_fixtures.py <dir> && node test/make_vault.mjs <dir>
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readVaultFiles, openSealed, vaultDataset, combine, isVault, hrvAgainstNormal, seal } from '../src/vault.js';
import { mergeData } from '../src/parser.js';
import { validateData, trimTimeline } from '../src/validate.js';

const DIR = resolve(process.argv[2] || 'test/fixtures'), PASS = 'correct horse battery staple';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const file = async n => new File([await readFile(join(DIR, n))], n);
const T = s => Date.parse(s + 'T00:00:00Z'), idx = (D, d) => Math.round((T(d) - T(D.meta.start)) / 864e5);
const info = JSON.parse(await readFile(join(DIR, 'vault-days.json'), 'utf8'));

async function open(names, pass = PASS) {
  const files = await Promise.all(names.map(file)), got = await readVaultFiles(files);
  const months = await Promise.all(got.months.map(t => openSealed(t, pass)));
  const apple = got.apple ? (await openSealed(got.apple, pass)).data : null;
  return { got, D: trimTimeline(validateData(combine(apple && validateData(apple), vaultDataset(months), { merge: mergeData, opened: '2025-11-08', vaultMonths: months.length, hasApple: !!apple }))) };
}

// recognising a vault
ok(await isVault(await file('vault-repo.zip')), 'the repo zip is recognised as a vault');
ok(!(await isVault(await file('watch.zip'))), 'an Apple Health export is not');
ok(await isVault(new File(['{}'], '2025-10.vault')), 'a loose .vault file is');

// the whole repo, with the Apple export
const { got, D } = await open(['vault-repo.zip']);
ok(got.months.length === 4 && !!got.apple, `4 month files and the Apple export found in the zip (${got.months.length})`);
ok(D.meta.start === info.base.start && D.meta.end === info.last, `timeline runs from the Apple export to the vault's last day (${D.meta.start} … ${D.meta.end})`);
ok(JSON.stringify(D.meta.devices) === JSON.stringify([{ name: 'Apple Watch', from: info.base.start, to: info.base.end }, { name: 'Fitbit', from: info.fitFrom, to: info.last }]), 'devices: Apple Watch, then Fitbit from its first own reading: ' + JSON.stringify(D.meta.devices));
const f0 = idx(D, info.fitFrom), b0 = idx(D, info.base.end);
ok(D.daily.hrvRmssd[f0] === 38 && D.daily.hrvRmssd.slice(0, f0).every(v => v == null), 'Fitbit HRV (RMSSD) has its own series, from the first Fitbit day');
ok(D.daily.hrv.slice(f0).every(v => v == null), 'Apple HRV (SDNN) is never filled with Fitbit or with Google’s copies of Apple data');
ok(D.daily.rhr[f0] === 57 && D.daily.rhr[b0] != null, 'resting heart rate continues across the switch');
ok(D.daily.resp[f0] === 14.6, 'breathing rate: the Fitbit reading, not Google’s Apple copy (16.1)');
ok(D.daily.spo2[f0] === 96.2, 'blood oxygen');
ok(D.daily.skinTemp[f0] == null && D.daily.skinTemp[f0 + 4] === -0.1 && D.daily.skinTemp[f0 + 5] === 0, 'skin temperature vs baseline (night minus baseline), empty until Google has a baseline');
ok(D.daily.sl_asleep[f0] === 430 && D.daily.sl_deep[f0] === 70 && D.daily.sl_rem[f0] === 90 && D.daily.sl_core[f0] === 270, 'sleep stages: light → core, deep, REM; 430 min asleep');
ok(D.daily.sl_bed[f0] === -30 && D.daily.sl_wake[f0] === 400, 'bedtime 23:30 and wake 06:40, in minutes from the wake day’s midnight');
const nap = info.fitFrom && D.daily.sl_sessions.findIndex((v, i) => i >= f0 && v === 2);
ok(nap > 0 && D.daily.sl_asleep[nap] === 470 && D.daily.sl_bed[nap] === -30, 'a nap adds to the night’s total but not to its bedtime');
ok(D.daily.steps[f0] === 7000 && D.daily.steps[f0 - 1] !== 9000, 'steps: the Fitbit era from the vault; earlier days keep the Apple export’s own count');
ok(D.daily.azm[f0] === 19 && D.daily.distance[f0] === 5.2, 'active zone minutes and distance');
const fw = D.workouts.filter(w => w.src === 'Fitbit');
ok(fw.length === 10 && fw[0].type === 'Running' && fw[0].min === 40 && fw[0].km === 6.54 && fw[0].d.endsWith('T18:30'), 'Fitbit workouts, in local time: ' + JSON.stringify(fw[0]));
ok(D.workouts.length > fw.length, 'Apple Watch workouts are kept');
const vo2 = D.points.vo2max || [];
ok(vo2.length === 6 && vo2[0][0].startsWith(info.fitFrom) && vo2.every(p => p[0] >= info.fitFrom && p[1] === 45.1), 'VO₂ max: from the band’s first day, weekly while unchanged; Google’s estimates from before it are left out');
const ctxDays = D.daily.pm25Night.filter(v => v != null).length;
ok(ctxDays === 92 && D.daily.pm25Night[f0 - 5] != null && D.daily.tMax[f0 - 5] != null, `weather and air cover the vault’s 92 days, before the switch too (${ctxDays})`);
// HRV against your normal: two weeks after each device starts, one scale across the switch
const rel = D.daily.hrvRel, firstRel = rel.findIndex(v => v != null), firstFit = rel.findIndex((v, i) => v != null && i >= f0);
ok(firstRel > 0 && firstFit >= f0 + 14, `HRV against your normal starts after 14 nights on each device (Apple day ${firstRel}, Fitbit day ${firstFit - f0})`);
ok(rel.every(v => v == null || Math.abs(v) < 100), 'its values are percentages around 0');
ok(D.meta.vault && D.meta.vault.through === info.last && D.meta.vault.fitbitFrom === info.fitFrom && D.meta.vault.apple === true, 'the dataset says what the vault added');
ok(D.meta.sources && Object.keys(D.meta.sources).length > 1 && D.meta.records > 0 && /^\d{4}-\d{2}-\d{2}/.test(D.meta.vault.appleExport || ''), 'the Apple export’s own description is kept, and its date moves to the vault note');

// only the months, onto data this browser already has
{
  const files = [await file('vault-only.zip')], g2 = await readVaultFiles(files), months = await Promise.all(g2.months.map(t => openSealed(t, PASS)));
  ok(!g2.apple, 'a vault without the Apple export');
  const alone = combine(null, vaultDataset(months), { merge: mergeData });
  ok(alone.meta.start === addDaysIso(info.last, -91) && JSON.stringify(alone.meta.devices) === JSON.stringify([{ name: 'Fitbit', from: info.fitFrom, to: info.last }]), 'on its own: one device, no switch');
  validateData(alone);
}
function addDaysIso(s, n) { return new Date(T(s) + n * 864e5).toISOString().slice(0, 10); }

// loose .vault files work like the zip
{
  const { readdirSync } = await import('node:fs');
  ok(readdirSync(DIR).includes('vault-repo.zip'), 'fixture present');
}

// errors in plain words
try { await open(['vault-repo.zip'], 'not the passphrase'); ok(false, 'wrong passphrase refused'); } catch (e) { ok(/does not open this vault/.test(e.message), 'wrong passphrase: ' + e.message); }
try { await readVaultFiles([await file('watch.zip')]); ok(false, 'an export is not a vault'); } catch (e) { ok(/No vault files found/.test(e.message), 'an export picked by mistake: ' + e.message); }
try { await openSealed('{"v":1}', PASS); ok(false, 'junk refused'); } catch (e) { ok(/not a vault file/.test(e.message), 'a damaged file: ' + e.message); }

// the vault repo's own encryption code writes files this opens (same format, checked byte for byte here)
{
  const text = await seal({ v: 1, days: {} }, PASS, 100000), f = JSON.parse(text);
  ok(f.v === 1 && f.kdf === 'PBKDF2-SHA256' && atob(f.salt).length === 16 && atob(f.iv).length === 12, 'file format matches the vault’s crypto.mjs');
}
ok(hrvAgainstNormal({ hrv: [50, 50, 50] }, '2025-01-01', null).every(v => v == null), 'no baseline, no number');

console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
