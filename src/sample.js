// A made-up person, four years of plausible Apple Watch data, in the same shape the parser produces.
// Deterministic: the same day always gets the same values. Used for the demo and the home page only.
export function sampleData(endISO) {
  const DAY = 864e5;
  const end = endISO ? Date.parse(endISO + 'T00:00:00Z') : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const N = 1461, start = end - (N - 1) * DAY;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  // seeded noise per (day, channel)
  const h = (i, c) => { let x = (i * 374761393 + c * 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; x ^= x >>> 16; return ((x >>> 0) % 100000) / 100000; };
  const gauss = (i, c) => { const u = Math.max(1e-6, h(i, c)), v = h(i, c + 97); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const round = (v, d = 1) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
  const keys = ['steps', 'distance', 'flights', 'active', 'moveGoal', 'exercise', 'exerciseGoal', 'stand', 'standGoal', 'basal', 'daylight', 'standMin',
    'rhr', 'walkHr', 'hrv', 'resp', 'hrMin', 'hrMax', 'hrAvg', 'walkSpeed', 'stepLen', 'doubleSupport', 'asymmetry', 'stairUp', 'stairDown', 'envDb', 'phoneDb', 'envEvent', 'mindful',
    'sl_asleep', 'sl_awake', 'sl_core', 'sl_deep', 'sl_rem', 'sl_unspec', 'sl_bed', 'sl_wake', 'sl_mid', 'sl_sessions'];
  const daily = Object.fromEntries(keys.map(k => [k, new Array(N).fill(null)]));
  const workouts = [], points = { vo2max: [], weight: [], hrRecovery: [], height: [] };
  const TYPES = [['Running', 36, 5.6, 152], ['Strength training', 46, 0, 118], ['Cycling', 52, 18.5, 136], ['Yoga', 32, 0, 96], ['Walking', 48, 4.1, 108]];
  for (let i = 0; i < N; i++) {
    const t = start + i * DAY, d = new Date(t), wd = d.getUTCDay(), weekend = wd === 0 || wd === 6, doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY;
    const season = Math.cos((doy - 196) / 365 * 2 * Math.PI); // +1 mid-July, -1 mid-January
    const fit = i / N;                                          // slowly getting fitter
    const off = h(i, 1) < .03 || (i > 700 && i < 712);          // watch off: a few random days and one holiday
    // workouts: about three a week
    let wmin = 0, whr = 0;
    if (!off && h(i, 2) < .42 && !(wd === 3 && h(i, 3) < .5)) {
      const ty = TYPES[Math.floor(h(i, 4) * TYPES.length)], min = round(ty[1] * (.8 + h(i, 5) * .5), 1), km = ty[2] ? round(ty[2] * min / ty[1], 2) : null;
      const hr = Math.round(ty[3] + gauss(i, 6) * 5 - fit * 4), start2 = weekend ? 9 + Math.floor(h(i, 7) * 3) : 18 + Math.floor(h(i, 7) * 2);
      const w = { d: `${iso(t)}T${String(start2).padStart(2, '0')}:${String(Math.floor(h(i, 8) * 60)).padStart(2, '0')}`, type: ty[0], min, src: 'Apple Watch', kcal: Math.round(min * (ty[3] - 60) / 9), hr, hrMax: hr + 18 + Math.round(h(i, 9) * 12) };
      if (km) w.km = km; if (ty[0] === 'Running' || ty[0] === 'Cycling' || ty[0] === 'Walking') w.indoor = h(i, 10) < .15;
      workouts.push(w); wmin = min; whr = hr;
    }
    if (!off) {
      let steps = 7600 + season * 900 + (weekend ? (h(i, 11) < .35 ? 5200 : -1700) : 0) + gauss(i, 12) * 1900 + (wmin && workouts[workouts.length - 1].type.match(/Running|Walking/) ? wmin * 110 : 0) + fit * 700;
      steps = Math.max(900, steps);
      daily.steps[i] = round(steps, 1); daily.distance[i] = round(steps * .00074, 2); daily.flights[i] = round(Math.max(0, 6 + gauss(i, 13) * 4), 1);
      const active = 360 + (steps - 7000) * .032 + wmin * 7.5 + gauss(i, 14) * 40;
      daily.active[i] = round(Math.max(60, active), 1); daily.moveGoal[i] = i < 500 ? 450 : 520;
      daily.exercise[i] = Math.max(0, Math.round(9 + wmin * .9 + (steps - 7000) / 900 + gauss(i, 15) * 5)); daily.exerciseGoal[i] = 30;
      daily.stand[i] = Math.max(4, Math.min(16, Math.round(11 + gauss(i, 16) * 1.8 - (weekend ? 1 : 0)))); daily.standGoal[i] = 12;
      daily.standMin[i] = round(daily.stand[i] * 5.5 + gauss(i, 17) * 8, 1); daily.basal[i] = round(1690 + gauss(i, 18) * 35, 1);
      daily.daylight[i] = Math.max(0, Math.round(28 + season * 16 + (weekend ? 22 : 0) + gauss(i, 19) * 14));
      const rhr = 61 - fit * 5 + gauss(i, 20) * 1.6 + (h(i, 21) < .04 ? 5 : 0);
      daily.rhr[i] = round(rhr, 1); daily.walkHr[i] = round(104 - fit * 5 + gauss(i, 22) * 3.5, 1);
      daily.hrv[i] = round(Math.max(18, 44 + fit * 7 - (rhr - 58) * 2.2 + gauss(i, 23) * 8), 1); daily.resp[i] = round(14.6 + gauss(i, 24) * .45, 2);
      daily.hrMin[i] = round(rhr - 9 + gauss(i, 25) * 2.5, 1); daily.hrMax[i] = round(Math.max(118, (whr ? whr + 22 : 126) + gauss(i, 26) * 9), 1); daily.hrAvg[i] = round(74 + gauss(i, 27) * 3.5 + wmin / 30, 1);
      daily.walkSpeed[i] = round(4.85 + fit * .12 + gauss(i, 28) * .18, 2); daily.stepLen[i] = round(71.5 + gauss(i, 29) * 1.6, 1);
      daily.doubleSupport[i] = round(.268 + gauss(i, 30) * .012, 4); daily.asymmetry[i] = h(i, 31) < .25 ? round(.02 + h(i, 32) * .03, 4) : null;
      daily.stairUp[i] = h(i, 33) < .6 ? round(.46 + gauss(i, 34) * .04, 3) : null; daily.stairDown[i] = daily.stairUp[i] ? round(.52 + gauss(i, 35) * .05, 3) : null;
      daily.envDb[i] = round(63 + gauss(i, 36) * 4.5 + (weekend ? 3 : 0), 1); daily.phoneDb[i] = h(i, 37) < .8 ? round(69 + gauss(i, 38) * 4, 1) : null;
      if (h(i, 39) < .02) daily.envEvent[i] = 1; if (h(i, 40) < .12) daily.mindful[i] = Math.round(3 + h(i, 41) * 10);
    }
    // sleep (dated by the morning you woke up)
    if (!off && h(i, 42) > .04) {
      const late = (wd === 6 || wd === 0) ? 50 : wd === 5 ? 25 : 0;
      const bed = -55 + late + gauss(i, 43) * 28 + (h(i, 44) < .06 ? 70 : 0);
      const rough = 42 * Math.exp(-(((i - 560) / 70) ** 2)), better = 22 * Math.max(0, (i - 1050) / 400);   // a hard few months, then a better last year
      const asleep = Math.max(290, 406 + (weekend ? 38 : -6) + gauss(i, 45) * 34 + season * -9 - rough + better - (h(i, 44) < .06 ? 55 : 0));
      const awake = Math.max(4, 17 + gauss(i, 46) * 7), wake = bed + asleep + awake;
      const deep = asleep * (.15 + gauss(i, 47) * .018), rem = asleep * (.225 + gauss(i, 48) * .02);
      daily.sl_asleep[i] = round(asleep, 1); daily.sl_awake[i] = round(awake, 1); daily.sl_deep[i] = round(deep, 1); daily.sl_rem[i] = round(rem, 1);
      daily.sl_core[i] = round(asleep - deep - rem, 1); daily.sl_unspec[i] = 0; daily.sl_bed[i] = round(bed, 1); daily.sl_wake[i] = round(wake, 1);
      daily.sl_mid[i] = round((bed + wake) / 2, 1); daily.sl_sessions[i] = 1;
    }
    // occasional readings
    if (i % 9 === 3 && !off) points.vo2max.push([`${iso(t)}T18:40`, round(42.2 + fit * 3.6 + gauss(i, 49) * .5, 2)]);
    if (i % 6 === 1) points.weight.push([`${iso(t)}T07:10`, round(74.8 - fit * 2.4 + Math.sin(i / 60) * .5 + gauss(i, 50) * .25, 2)]);
    if (wmin && whr > 130 && h(i, 51) < .5) points.hrRecovery.push([`${iso(t)}T19:30`, round(24 + fit * 4 + gauss(i, 52) * 3, 2)]);
  }
  points.height.push([`${iso(start)}T09:00`, 176]);
  const clean = {}; for (const k in daily) if (daily[k].some(v => v != null)) clean[k] = daily[k];
  return {
    meta: { generated: 'sample', exportDate: iso(end) + ' 08:00:00 +0000', start: iso(start), end: iso(end), days: N, sources: { 'Apple Watch': 1, iPhone: 1 }, sleepGoal: [], sleepSource: 'watch', unitsHint: 'metric', sample: true },
    daily: clean, points, workouts,
  };
}
