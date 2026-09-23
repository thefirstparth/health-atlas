// Apple Health export -> compact dataset, entirely in the browser (or Node, for tests).
// Port of pipeline/parse_health.py. Output must match it value for value; see test/parity.py.
//
// Security: the XML is tokenised by hand. The DOCTYPE is skipped, entities are never
// resolved except the five predefined ones and numeric character references.

const HK = 'HKQuantityTypeIdentifier';
const CUMULATIVE = {
  StepCount: 'steps', DistanceWalkingRunning: 'distance', FlightsClimbed: 'flights', DistanceCycling: 'cycling',
  BasalEnergyBurned: 'basal', TimeInDaylight: 'daylight', AppleStandTime: 'standMin', DistanceSwimming: 'swimming',
};
const MEAN = {
  RestingHeartRate: 'rhr', WalkingHeartRateAverage: 'walkHr', HeartRateVariabilitySDNN: 'hrv', RespiratoryRate: 'resp',
  WalkingSpeed: 'walkSpeed', WalkingStepLength: 'stepLen', WalkingDoubleSupportPercentage: 'doubleSupport',
  WalkingAsymmetryPercentage: 'asymmetry', StairAscentSpeed: 'stairUp', StairDescentSpeed: 'stairDown',
  RunningSpeed: 'runSpeed', RunningPower: 'runPower', RunningGroundContactTime: 'runGct',
  RunningVerticalOscillation: 'runVo', RunningStrideLength: 'runStride', PhysicalEffort: 'effort',
};
const POINTS = {
  VO2Max: 'vo2max', HeartRateRecoveryOneMinute: 'hrRecovery', AppleWalkingSteadiness: 'steadiness',
  SixMinuteWalkTestDistance: 'sixMin', BodyMass: 'weight', Height: 'height', BloodPressureSystolic: 'bpSys',
  BloodPressureDiastolic: 'bpDia', EstimatedWorkoutEffortScore: 'effortEst', WorkoutEffortScore: 'effortRated',
};
const AUDIO = { EnvironmentalAudioExposure: 'envDb', HeadphoneAudioExposure: 'phoneDb' };
const prefix = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [HK + k, v]));
const T_CUM = prefix(CUMULATIVE), T_MEAN = prefix(MEAN), T_PTS = prefix(POINTS), T_AUD = prefix(AUDIO);
const UNIT_FIX = {
  'walkSpeed|m/s': 3.6, 'runSpeed|m/s': 3.6, 'stepLen|m': 100, 'runVo|m': 100, 'runStride|cm': 0.01,
  'distance|m': 0.001, 'cycling|m': 0.001, 'distance|mi': 1.609344, 'cycling|mi': 1.609344,
  'weight|lb': 0.45359237, 'basal|kJ': 1 / 4.184, 'height|m': 100, 'sixMin|km': 1000,
  // not in the Python reference (the reference exports never use them); harmless for parity
  'distance|ft': 0.0003048, 'cycling|ft': 0.0003048, 'swimming|yd': 0.9144, 'swimming|km': 1000,
  'weight|g': 0.001, 'weight|st': 6.35029318, 'height|in': 2.54, 'height|ft': 30.48, 'height|m ': 100,
  'sixMin|ft': 0.3048, 'sixMin|yd': 0.9144, 'stepLen|in': 2.54, 'stepLen|ft': 30.48, 'walkSpeed|mi/hr': 1.609344,
  'runSpeed|mi/hr': 1.609344, 'stairUp|ft/s': 0.3048, 'stairDown|ft/s': 0.3048,
  'runVo|in': 2.54, 'runStride|ft': 0.3048, 'runStride|in': 0.0254, 'basal|Cal': 1,
};
const fix = (k, unit) => UNIT_FIX[k + '|' + unit] || 1;
const SLEEP_STAGE = {
  HKCategoryValueSleepAnalysisAsleepCore: 'core', HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem', HKCategoryValueSleepAnalysisAsleepUnspecified: 'unspec',
  HKCategoryValueSleepAnalysisAsleep: 'unspec', HKCategoryValueSleepAnalysisAwake: 'awake',
};
const EVENTS = {
  HKCategoryTypeIdentifierHighHeartRateEvent: 'highHr', HKCategoryTypeIdentifierLowHeartRateEvent: 'lowHr',
  HKCategoryTypeIdentifierIrregularHeartRhythmEvent: 'irregular', HKCategoryTypeIdentifierAudioExposureEvent: 'envEvent',
  HKCategoryTypeIdentifierHeadphoneAudioExposureEvent: 'phoneEvent',
};
const WORKOUT_NAMES = {
  TraditionalStrengthTraining: 'Strength training', FunctionalStrengthTraining: 'Functional strength',
  HighIntensityIntervalTraining: 'HIIT', MindAndBody: 'Mind & body', CardioDance: 'Cardio dance',
  TableTennis: 'Table tennis', Other: 'Other',
};

// Python's round(): exact binary value, ties to even.
export function pyRound(x, d = 0) {
  if (!isFinite(x)) return x;
  const s = Math.abs(x).toFixed(100 > d + 60 ? d + 60 : 100);
  const dot = s.indexOf('.'), tail = s.slice(dot + 1 + d);
  let r = Number(x.toFixed(d)); // ties resolved upward (toward +inf) by toFixed
  if (tail[0] === '5' && /^50*$/.test(tail)) {
    const m = Math.round(Math.abs(x) * 10 ** d - 0.5); // lower candidate magnitude
    const even = m % 2 === 0 ? m : m + 1;
    r = Math.sign(x) * even / 10 ** d;
    r = Number(r.toFixed(d));
  }
  return Object.is(r, -0) ? 0 : r;
}

// "2023-02-28 20:07:24 +0530" -> ms of the wall-clock time as if it were UTC
const ts = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19));
const isoMin = s => s.slice(0, 10) + 'T' + s.slice(11, 16);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
// Substrings of the parse buffer keep the whole buffer alive in V8, so nothing sliced from it is
// stored: days become numbers (YYYYMMDD) and the few strings we keep are copied into flat strings.
const dayNum = s => +s.slice(0, 4) * 10000 + +s.slice(5, 7) * 100 + +s.slice(8, 10);
const numIso = n => `${Math.floor(n / 10000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`;
const INTERN = new Map();
const I = s => { if (s == null) return s; let v = INTERN.get(s); if (v === undefined) { v = s.split('').join(''); INTERN.set(v, v); } return v; };
const KNAMES = [...new Set([...Object.values(CUMULATIVE), ...Object.values(MEAN), ...Object.values(AUDIO), 'highHr', 'lowHr', 'irregular', 'envEvent', 'phoneEvent'])];
const KIDX = Object.fromEntries(KNAMES.map((k, i) => [k, i + 1]));
const kd = (k, day) => KIDX[k] * 1e10 + day * 100;   // metric + day as one number
const unkd = x => [KNAMES[Math.floor(x / 1e10) - 1], numIso(Math.floor((x % 1e10) / 100))];

function wname(t) {
  t = t.replace('HKWorkoutActivityType', '');
  if (t in WORKOUT_NAMES) return WORKOUT_NAMES[t];
  let out = '';
  for (let i = 0; i < t.length; i++) { const c = t[i]; out += (i && c >= 'A' && c <= 'Z') ? ' ' + c.toLowerCase() : c; }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = v => v.indexOf('&') < 0 ? v : v.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch (_) { return m; } }
  return ENT[e] ?? m; // unknown (DTD-declared) entities are left as text, never expanded
});
const ATTR = /\s*([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

// ------------------------------------------------------------------ accumulator
function makeAcc() {
  return {
    cum: new Map(), mean: new Map(), hr: new Map(), points: new Map(), audio: new Map(), counts: new Map(),
    mindful: new Map(), sleep: [], rings: new Map(), workouts: [], sleepGoal: [], sources: new Map(),
    exportDate: null, me: {}, distUnits: { metric: 0, imperial: 0 }, depthWorkout: 0, depthCorr: 0, stack: [], curWorkout: null, records: 0,
  };
}

function onRecord(A, a) {
  const t = a.type, src = I(a.sourceName || '');
  A.sources.set(src, (A.sources.get(src) || 0) + 1);
  A.records++;
  const s = a.startDate;
  if (!s) return;
  const day = dayNum(s), unit = a.unit || '', v = a.value;
  let k;
  if ((k = T_CUM[t])) {
    if (k === 'distance') A.distUnits[unit === 'mi' || unit === 'ft' || unit === 'yd' ? 'imperial' : 'metric']++;
    const val = parseFloat(v) * fix(k, unit), key = kd(k, day) + (+s.slice(11, 13));
    let m = A.cum.get(key); if (!m) A.cum.set(key, (m = new Map()));
    m.set(src, (m.get(src) || 0) + val);
  } else if ((k = T_MEAN[t])) {
    const val = parseFloat(v) * fix(k, unit), key = kd(k, day);
    const m = A.mean.get(key); if (m) { m[0] += val; m[1]++; } else A.mean.set(key, [val, 1]);
  } else if (t === HK + 'HeartRate') {
    const val = parseFloat(v), h = A.hr.get(day);
    if (!h) A.hr.set(day, [val, val, val, 1]);
    else { if (val < h[0]) h[0] = val; if (val > h[1]) h[1] = val; h[2] += val; h[3]++; }
  } else if ((k = T_PTS[t])) {
    const val = pyRound(parseFloat(v) * fix(k, unit), 2);
    let m = A.points.get(k); if (!m) A.points.set(k, (m = new Map()));
    const iso = I(isoMin(s)); m.set(iso + '|' + val, [iso, val]);
  } else if ((k = T_AUD[t])) {
    const st = ts(s), en = ts(a.endDate), dur = Math.max((en - st) / 1000, 1.0), key = kd(k, day);
    let acc = A.audio.get(key); if (!acc) A.audio.set(key, (acc = [0, 0]));
    acc[0] += (10 ** (parseFloat(v) / 10)) * dur; acc[1] += dur;
  } else if (t === 'HKCategoryTypeIdentifierSleepAnalysis') {
    const stg = SLEEP_STAGE[v];
    if (stg) A.sleep.push([ts(s), ts(a.endDate), stg, src.includes('Watch')]);
  } else if ((k = EVENTS[t])) {
    const key = kd(k, day); A.counts.set(key, (A.counts.get(key) || 0) + 1);
  } else if (t === 'HKCategoryTypeIdentifierMindfulSession') {
    A.mindful.set(day, (A.mindful.get(day) || 0) + (ts(a.endDate) - ts(s)) / 60000);
  } else if (t === 'HKDataTypeSleepDurationGoal') {
    A.sleepGoal.push([numIso(day), parseFloat(v)]);
  }
}

function startWorkout(A, a) {
  const st = a.startDate;
  let dur = parseFloat(a.duration || 0) || 0;
  if (a.durationUnit === 'sec') dur /= 60;
  if (a.durationUnit === 'hr') dur *= 60;
  A.curWorkout = { a, w: { d: I(isoMin(st)), type: I(wname(a.workoutActivityType || '')), min: pyRound(dur, 1), src: I(a.sourceName || '') } };
}
function workoutChild(A, tag, c) {
  const W = A.curWorkout; if (!W) return; const w = W.w;
  if (tag === 'WorkoutStatistics') {
    const ct = c.type || '';
    if (ct.endsWith('ActiveEnergyBurned') && c.sum) {
      let val = parseFloat(c.sum); if (c.unit === 'kJ') val /= 4.184; w.kcal = pyRound(val);
    } else if (ct.endsWith('HeartRate') && c.average) {
      w.hr = pyRound(parseFloat(c.average)); if (c.maximum) w.hrMax = pyRound(parseFloat(c.maximum));
    } else if (ct.includes('Distance') && c.sum) {
      let val = parseFloat(c.sum); const u = c.unit;
      if (u === 'm') val /= 1000; else if (u === 'mi') val *= 1.609344; else if (u === 'yd') val *= 0.0009144;
      w.km = pyRound((w.km || 0) + val, 2);
    }
  } else if (tag === 'MetadataEntry' && c.key === 'HKIndoorWorkout') {
    w.indoor = c.value === '1';
  }
}
function endWorkout(A) {
  const W = A.curWorkout; if (!W) return; const { a, w } = W;
  if (!('kcal' in w) && a.totalEnergyBurned) w.kcal = pyRound(parseFloat(a.totalEnergyBurned));
  if (!('km' in w) && a.totalDistance && parseFloat(a.totalDistance) > 0) {
    const val = parseFloat(a.totalDistance), u = a.totalDistanceUnit;
    w.km = pyRound(val * (u === 'mi' ? 1.609344 : u === 'm' ? 0.001 : 1), 2);
  }
  A.workouts.push(w); A.curWorkout = null;
}
function onSummary(A, a) {
  const d = a.dateComponents; if (!d) return;
  const f = x => { const s = a[x]; if (s == null || s.trim() === '') return null; const n = Number(s.trim()); return isNaN(n) ? null : n; };
  A.rings.set(dayNum(d), { move: f('activeEnergyBurned'), moveGoal: f('activeEnergyBurnedGoal'), exercise: f('appleExerciseTime'),
    exerciseGoal: f('appleExerciseTimeGoal'), stand: f('appleStandHours'), standGoal: f('appleStandHoursGoal') });
}

// element events: start (with attrs, selfClose) and end
function onStart(A, tag, attrs, selfClose) {
  const parent = A.stack.length ? A.stack[A.stack.length - 1] : null;
  if (tag === 'Record') {
    if (!A.depthWorkout) onRecord(A, attrs);
  } else if (tag === 'Workout') {
    A.depthWorkout++; if (A.depthWorkout === 1) startWorkout(A, attrs);
  } else if (tag === 'Correlation') {
    A.depthCorr++;
  } else if (parent === 'Workout' && A.depthWorkout === 1) {
    workoutChild(A, tag, attrs);
  } else if (tag === 'ActivitySummary') onSummary(A, attrs);
  else if (tag === 'ExportDate') A.exportDate = I(attrs.value ?? null);
  else if (tag === 'Me') A.me = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [I(k), I(v)]));
  if (selfClose) onEnd(A, tag); else A.stack.push(tag);
}
function onEnd(A, tag) {
  if (tag === 'Workout') { if (A.depthWorkout === 1) endWorkout(A); A.depthWorkout--; }
  else if (tag === 'Correlation') A.depthCorr--;
}

// ------------------------------------------------------------------ tokenizer
export function createXmlSink(A) {
  let buf = '', pos = 0, inDoctype = false;
  const attrsOf = (s, from, to) => {
    const o = {}; ATTR.lastIndex = from; let m;
    while (ATTR.lastIndex < to && (m = ATTR.exec(s))) { if (ATTR.lastIndex > to) break; o[m[1]] = unesc(m[2] ?? m[3]); }
    return o;
  };
  function feed(text, final) {
    buf = pos < buf.length ? buf.slice(pos) + text : text; pos = 0;
    const L = buf.length;
    while (pos < L) {
      if (inDoctype) { const j = buf.indexOf(']>', pos); if (j < 0) { pos = Math.max(pos, L - 1); break; } pos = j + 2; inDoctype = false; continue; }
      const lt = buf.indexOf('<', pos);
      if (lt < 0) { pos = L; break; }
      const c = buf.charCodeAt(lt + 1);
      if (lt + 1 >= L) { pos = lt; break; }
      if (c === 47 /* / */) {
        const gt = buf.indexOf('>', lt); if (gt < 0) { pos = lt; break; }
        const name = buf.slice(lt + 2, gt).trim();
        if (A.stack.length) A.stack.pop();
        onEnd(A, name); pos = gt + 1; continue;
      }
      if (c === 63 /* ? */) { const j = buf.indexOf('?>', lt); if (j < 0) { pos = lt; break; } pos = j + 2; continue; }
      if (c === 33 /* ! */) {
        if (buf.startsWith('<!--', lt)) { const j = buf.indexOf('-->', lt + 4); if (j < 0) { pos = lt; break; } pos = j + 3; continue; }
        if (buf.startsWith('<![CDATA[', lt)) { const j = buf.indexOf(']]>', lt); if (j < 0) { pos = lt; break; } pos = j + 3; continue; }
        // <!DOCTYPE ...> possibly with an internal subset [ ... ]
        const gt = buf.indexOf('>', lt), br = buf.indexOf('[', lt);
        if (gt < 0 && br < 0) { if (L - lt > 1e6) throw new Error('Malformed XML'); pos = lt; break; }
        if (br >= 0 && (gt < 0 || br < gt)) { inDoctype = true; pos = br + 1; continue; }
        pos = gt + 1; continue;
      }
      // start tag: name then attributes, ending in > or />
      let i = lt + 1; while (i < L) { const ch = buf.charCodeAt(i); if (ch <= 32 || ch === 62 || ch === 47) break; i++; }
      const name = buf.slice(lt + 1, i);
      // find the closing '>' outside quotes
      let j = i, q = 0;
      while (j < L) { const ch = buf.charCodeAt(j); if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch; else if (ch === 62) break; j++; }
      if (j >= L) { if (L - lt > 1e6) throw new Error('Malformed XML'); pos = lt; break; }
      const self = buf.charCodeAt(j - 1) === 47;
      const needAttrs = name === 'Record' ? !A.depthWorkout
        : name === 'Workout' || name === 'ActivitySummary' || name === 'ExportDate' || name === 'Me'
          || (A.depthWorkout === 1 && A.stack[A.stack.length - 1] === 'Workout' && (name === 'WorkoutStatistics' || name === 'MetadataEntry'));
      onStart(A, name, needAttrs ? attrsOf(buf, i, self ? j - 1 : j) : {}, self);
      pos = j + 1;
    }
    if (final) buf = '';
  }
  return { feed };
}

// ------------------------------------------------------------------ assemble
function unionMinutes(segs) {
  segs = segs.slice().sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let tot = 0, cs = null, ce = null;
  for (const [a, b] of segs) {
    if (cs === null) { cs = a; ce = b; }
    else if (a <= ce) ce = Math.max(ce, b);
    else { tot += (ce - cs) / 1000; cs = a; ce = b; }
  }
  if (cs !== null) tot += (ce - cs) / 1000;
  return tot / 60;
}

export function assemble(A, { generated } = {}) {
  const daily = new Map(); const D = day => { let o = daily.get(day); if (!o) daily.set(day, (o = {})); return o; };
  const agg = new Map();
  for (const [key, bysrc] of A.cum) {
    const x = key - (key % 100);
    let mx = -Infinity; for (const v of bysrc.values()) if (v > mx) mx = v;
    agg.set(x, (agg.get(x) || 0) + mx);
  }
  for (const [x, v] of agg) { const [k, day] = unkd(x); D(day)[k] = v; }
  for (const [x, [s, n]] of A.mean) { const [k, day] = unkd(x); D(day)[k] = s / n; }
  for (const [day, [mn, mx, s, n]] of A.hr) { const o = D(numIso(day)); o.hrMin = mn; o.hrMax = mx; o.hrAvg = s / n; }
  for (const [x, [e, d]] of A.audio) { const [k, day] = unkd(x); if (d > 0) D(day)[k] = 10 * Math.log10(e / d); }
  for (const [x, n] of A.counts) { const [k, day] = unkd(x); D(day)[k] = n; }
  for (const [day, m] of A.mindful) D(numIso(day)).mindful = m;
  for (const [dn, r] of A.rings) { const day = numIso(dn);
    if (r.move !== null && (r.move > 0 || (r.exercise || 0) > 0 || (r.stand || 0) > 0)) {
      const o = D(day); o.active = r.move; o.exercise = r.exercise; o.stand = r.stand;
      if (r.moveGoal) o.moveGoal = r.moveGoal; if (r.exerciseGoal) o.exerciseGoal = r.exerciseGoal; if (r.standGoal) o.standGoal = r.standGoal;
    }
  }

  // sleep: Apple Watch staged data; if an export has none, fall back to any source with sleep stages
  let sl = A.sleep.filter(x => x[3]);
  let sleepSource = 'watch';
  if (!sl.length && A.sleep.length) { sl = A.sleep.slice(); sleepSource = 'other'; }
  if (!sl.length) sleepSource = null;
  sl.sort((x, y) => x[0] - y[0]); // stable, like Python's sorted
  const sessions = [];
  for (const [st, en, stg] of sl) {
    const last = sessions[sessions.length - 1];
    if (last && st <= last.end + 3600e3) { last.end = Math.max(last.end, en); last.seg.push([st, en, stg]); }
    else sessions.push({ start: st, end: en, seg: [[st, en, stg]] });
  }
  const nights = new Map();
  for (const s of sessions) {
    const asl = s.seg.filter(x => x[2] !== 'awake').map(x => [x[0], x[1]]);
    if (!asl.length) continue;
    const asleep = unionMinutes(asl);
    if (asleep < 20) continue;
    const rec = { asleep, awake: unionMinutes(s.seg.filter(x => x[2] === 'awake').map(x => [x[0], x[1]])) };
    for (const g of ['core', 'deep', 'rem', 'unspec']) rec[g] = unionMinutes(s.seg.filter(x => x[2] === g).map(x => [x[0], x[1]]));
    let first = Infinity, lastEnd = -Infinity; for (const [a, b] of asl) { if (a < first) first = a; if (b > lastEnd) lastEnd = b; }
    const wakeDay = isoDay(lastEnd), base = Date.parse(wakeDay + 'T00:00:00Z');
    rec.bed = (first - base) / 60000; rec.wake = (lastEnd - base) / 60000; rec.sessions = 1; rec.mid = (rec.bed + rec.wake) / 2;
    const prev = nights.get(wakeDay);
    if (!prev) nights.set(wakeDay, rec);
    else {
      const [main] = prev.asleep >= rec.asleep ? [prev, rec] : [rec, prev];
      const merged = { ...main };
      for (const g of ['asleep', 'awake', 'core', 'deep', 'rem', 'unspec']) merged[g] = prev[g] + rec[g];
      merged.sessions = prev.sessions + 1; nights.set(wakeDay, merged);
    }
  }
  for (const [day, n] of nights) {
    const o = D(day);
    for (const k of ['asleep', 'awake', 'core', 'deep', 'rem', 'unspec', 'bed', 'wake', 'mid']) o['sl_' + k] = n[k];
    o.sl_sessions = n.sessions;
  }

  if (!daily.size) return null;
  const days = [...daily.keys()].sort();
  const start = days[0], end = days[days.length - 1];
  const t0 = Date.parse(start + 'T00:00:00Z');
  const n = Math.round((Date.parse(end + 'T00:00:00Z') - t0) / 864e5) + 1;
  const keys = [...new Set([...daily.values()].flatMap(o => Object.keys(o)))].sort();
  const DEC = { distance: 2, cycling: 2, doubleSupport: 4, asymmetry: 4, stairUp: 3, stairDown: 3, runStride: 3, walkSpeed: 2, runSpeed: 2, resp: 2, effort: 2 };
  const cols = {};
  for (const k of keys) {
    const arr = new Array(n).fill(null), dec = DEC[k] ?? 1;
    for (const [d, vals] of daily) { const v = vals[k]; if (v != null) arr[Math.round((Date.parse(d + 'T00:00:00Z') - t0) / 864e5)] = pyRound(v, dec); }
    cols[k] = arr;
  }
  const workouts = A.workouts.slice().sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  const points = {};
  for (const [k, m] of A.points) points[k] = [...m.values()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  const sources = Object.fromEntries([...A.sources.entries()].sort((a, b) => b[1] - a[1]));
  return {
    meta: {
      generated: generated || new Date().toISOString().slice(0, 16).replace('T', ' '), exportDate: A.exportDate,
      start, end, days: n, sources,
      dob: A.me.HKCharacteristicTypeIdentifierDateOfBirth ?? null,
      sex: (A.me.HKCharacteristicTypeIdentifierBiologicalSex || '').replace('HKBiologicalSex', ''),
      sleepGoal: A.sleepGoal, sleepSource, records: A.records,
      unitsHint: A.distUnits.imperial > A.distUnits.metric ? 'imperial' : A.distUnits.metric ? 'metric' : null,
    },
    daily: cols, points, workouts,
  };
}

// ------------------------------------------------------------------ zip + driver
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;
const readBytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());

export const LIMITS = { maxXmlBytes: 16 * 2 ** 30 }; // 16 GB decompressed: far beyond any real export

// Locate export.xml inside a zip via the central directory (handles zip64 and data descriptors).
export async function findExportXml(blob) {
  const size = blob.size, tailLen = Math.min(size, 65557 + 20);
  const tail = await readBytes(blob, size - tailLen, size);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This does not look like a zip file.');
  let cdCount = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  const loc = e - 20;
  if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
    const z64off = u64(tail, loc + 8);
    const z = await readBytes(blob, z64off, z64off + 56);
    if (u32(z, 0) === 0x06064b50) { cdCount = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48); }
  }
  if (cdSize > 256 * 2 ** 20) throw new Error('Zip directory is unreasonably large.');
  const cd = await readBytes(blob, cdOff, cdOff + cdSize);
  const dec = new TextDecoder();
  let p = 0, found = null;
  for (let n = 0; n < cdCount && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24), lho = u32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nl));
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = u16(cd, x), len = u16(cd, x + 2); let q = x + 4;
      if (id === 1) { if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; } if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; } if (lho === 0xffffffff) { lho = u64(cd, q); q += 8; } }
      x += 4 + len;
    }
    if ((name === 'export.xml' || name.endsWith('/export.xml')) && !name.includes('__MACOSX')) { found = { name, method, csize, usize, lho }; break; }
    p += 46 + nl + xl + cl;
  }
  if (!found) throw new Error('No export.xml inside this zip. Use the export.zip from the Health app.');
  const lh = await readBytes(blob, found.lho, found.lho + 30);
  if (u32(lh, 0) !== 0x04034b50) throw new Error('Corrupt zip file.');
  found.dataStart = found.lho + 30 + u16(lh, 26) + u16(lh, 28);
  if (found.method !== 0 && found.method !== 8) throw new Error('Unsupported zip compression.');
  return found;
}

// input: Blob/File. onProgress(fraction 0..1, stage). Returns dataset or null if no usable data.
export async function parseExport(blob, { onProgress = () => {}, isZip, DecompressionStreamImpl, generated, beforeAssemble } = {}) {
  const head = await readBytes(blob, 0, 4);
  const zip = isZip ?? (u32(head, 0) === 0x04034b50);
  let stream, total;
  if (zip) {
    const f = await findExportXml(blob);
    total = f.usize;
    if (total > LIMITS.maxXmlBytes) throw new Error('export.xml is larger than this app can process.');
    const raw = blob.slice(f.dataStart, f.dataStart + f.csize).stream();
    const DS = DecompressionStreamImpl || globalThis.DecompressionStream;
    stream = f.method === 8 ? raw.pipeThrough(new DS('deflate-raw')) : raw;
  } else {
    total = blob.size; stream = blob.stream();
  }
  const A = makeAcc(), sink = createXmlSink(A), td = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let done = 0, lastReport = 0, first = true;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    done += value.byteLength;
    if (done > Math.max(total * 1.01, total + 1e6) || done > LIMITS.maxXmlBytes) { reader.cancel(); throw new Error('The file expands to more data than its header declares.'); }
    let text = td.decode(value, { stream: true });
    if (first) { if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); first = false;
      if (!/<\?xml|<HealthData|<!DOCTYPE/.test(text.slice(0, 4096))) { reader.cancel(); throw new Error('This file is not an Apple Health export.'); } }
    sink.feed(text, false);
    if (done - lastReport > 4e6) { lastReport = done; onProgress(Math.min(done / total, 0.999), 'reading'); }
  }
  sink.feed(td.decode(), true);
  onProgress(1, 'assembling');
  if (beforeAssemble) beforeAssemble(A);
  return assemble(A, { generated });
}

// build.py merge(): the newer dataset wins wherever it has a value; old-only values are kept.
export function mergeData(old, nu) {
  const s0 = old.meta.start < nu.meta.start ? old.meta.start : nu.meta.start;
  const e0 = old.meta.end > nu.meta.end ? old.meta.end : nu.meta.end;
  const T = s => Date.parse(s + 'T00:00:00Z'), n = Math.round((T(e0) - T(s0)) / 864e5) + 1;
  const off = d => Math.round((T(d.meta.start) - T(s0)) / 864e5);
  const daily = {};
  for (const k of new Set([...Object.keys(old.daily), ...Object.keys(nu.daily)])) {
    const arr = new Array(n).fill(null);
    for (const src of [old, nu]) { const o = off(src), a = src.daily[k] || []; for (let i = 0; i < a.length; i++) if (a[i] != null) arr[i + o] = a[i]; }
    daily[k] = arr;
  }
  const points = {};
  for (const k of new Set([...Object.keys(old.points), ...Object.keys(nu.points)])) {
    const m = new Map(); for (const p of [...(old.points[k] || []), ...(nu.points[k] || [])]) m.set(p[0] + '|' + p[1], p);
    points[k] = [...m.values()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  }
  const wk = new Map(); for (const w of [...old.workouts, ...nu.workouts]) wk.set([w.d, w.type, w.src, w.min].join('|'), w);
  const g = new Map(); for (const x of [...(old.meta.sleepGoal || []), ...(nu.meta.sleepGoal || [])]) g.set(x.join('|'), x);
  const meta = { ...nu.meta, start: s0, end: e0, days: n, sleepGoal: [...g.values()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]) };
  return { meta, daily, points, workouts: [...wk.values()].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0) };
}
