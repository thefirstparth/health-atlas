#!/usr/bin/env python3
"""
Apple Health export -> compact data.json for the dashboard.

Usage:  python3 parse_health.py <export.zip | export.xml> <out data.json>

Principles
- No inference, no scores. Only values that exist in the export, aggregated per day.
- Times are the local wall-clock time written in each record (offset ignored),
  so travel across time zones still reads as "what the clock said".
- Cumulative quantities (steps, distance, flights, energy) are recorded by several
  sources (Watch, iPhone, Nike Run Club...). To avoid double counting, each hour
  takes the highest single-source total for that hour, then hours are summed.
- Ring values (active energy, exercise minutes, stand hours, goals) come straight
  from Apple's ActivitySummary rows.
- Records nested inside <Workout> are duplicates of top-level records (per Apple's
  DTD) and are skipped. Records nested inside <Correlation> (blood pressure) are
  de-duplicated by (type, start, value).
"""
import sys, json, zipfile, math, io
from collections import defaultdict
from datetime import datetime, timedelta, date
from lxml import etree

HK = "HKQuantityTypeIdentifier"

# hourly-max-dedup cumulative metrics: type -> key
CUMULATIVE = {
    HK + "StepCount": "steps",
    HK + "DistanceWalkingRunning": "distance",      # km
    HK + "FlightsClimbed": "flights",
    HK + "DistanceCycling": "cycling",              # km
    HK + "BasalEnergyBurned": "basal",              # kcal
    HK + "TimeInDaylight": "daylight",              # min
    HK + "AppleStandTime": "standMin",              # min
    HK + "DistanceSwimming": "swimming",            # m
}
# per-day mean of samples: type -> key
MEAN = {
    HK + "RestingHeartRate": "rhr",
    HK + "WalkingHeartRateAverage": "walkHr",
    HK + "HeartRateVariabilitySDNN": "hrv",
    HK + "RespiratoryRate": "resp",
    HK + "WalkingSpeed": "walkSpeed",               # km/hr
    HK + "WalkingStepLength": "stepLen",            # cm
    HK + "WalkingDoubleSupportPercentage": "doubleSupport",  # fraction
    HK + "WalkingAsymmetryPercentage": "asymmetry", # fraction
    HK + "StairAscentSpeed": "stairUp",             # m/s
    HK + "StairDescentSpeed": "stairDown",
    HK + "RunningSpeed": "runSpeed",                # km/hr
    HK + "RunningPower": "runPower",                # W
    HK + "RunningGroundContactTime": "runGct",      # ms
    HK + "RunningVerticalOscillation": "runVo",     # cm
    HK + "RunningStrideLength": "runStride",        # m
    HK + "PhysicalEffort": "effort",                # kcal/hr·kg (METs)
}
# sparse point series (every sample kept)
POINTS = {
    HK + "VO2Max": "vo2max",
    HK + "HeartRateRecoveryOneMinute": "hrRecovery",
    HK + "AppleWalkingSteadiness": "steadiness",
    HK + "SixMinuteWalkTestDistance": "sixMin",
    HK + "BodyMass": "weight",
    HK + "Height": "height",
    HK + "BloodPressureSystolic": "bpSys",
    HK + "BloodPressureDiastolic": "bpDia",
    HK + "EstimatedWorkoutEffortScore": "effortEst",
    HK + "WorkoutEffortScore": "effortRated",
}
# duration-weighted energetic (Leq) mean of dB samples
AUDIO = {
    HK + "EnvironmentalAudioExposure": "envDb",
    HK + "HeadphoneAudioExposure": "phoneDb",
}
UNIT_FIX = {  # convert to display units
    ("walkSpeed", "m/s"): 3.6, ("runSpeed", "m/s"): 3.6,
    ("stepLen", "m"): 100, ("runVo", "m"): 100, ("runStride", "cm"): 0.01,
    ("distance", "m"): 0.001, ("cycling", "m"): 0.001, ("distance", "mi"): 1.609344,
    ("cycling", "mi"): 1.609344, ("weight", "lb"): 0.45359237, ("basal", "kJ"): 1 / 4.184,
    ("height", "m"): 100, ("sixMin", "km"): 1000,
}
SLEEP_STAGE = {
    "HKCategoryValueSleepAnalysisAsleepCore": "core",
    "HKCategoryValueSleepAnalysisAsleepDeep": "deep",
    "HKCategoryValueSleepAnalysisAsleepREM": "rem",
    "HKCategoryValueSleepAnalysisAsleepUnspecified": "unspec",
    "HKCategoryValueSleepAnalysisAsleep": "unspec",
    "HKCategoryValueSleepAnalysisAwake": "awake",
}
WORKOUT_NAMES = {
    "TraditionalStrengthTraining": "Strength training", "FunctionalStrengthTraining": "Functional strength",
    "HighIntensityIntervalTraining": "HIIT", "MindAndBody": "Mind & body", "CardioDance": "Cardio dance",
    "TableTennis": "Table tennis", "Other": "Other",
}


def ts(s):
    # "2023-02-28 20:07:24 +0530" -> naive local datetime
    return datetime(int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19]))


def wname(t):
    t = t.replace("HKWorkoutActivityType", "")
    if t in WORKOUT_NAMES:
        return WORKOUT_NAMES[t]
    out = ""
    for i, c in enumerate(t):
        out += (" " + c.lower()) if (c.isupper() and i) else c
    return out


def open_xml(path):
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        name = next(n for n in z.namelist() if n.endswith("/export.xml") or n == "export.xml")
        return z.open(name)
    return open(path, "rb")


def main(src, out):
    cum = defaultdict(lambda: defaultdict(float))  # (key, day, hour) -> {source: sum}
    mean = defaultdict(lambda: [0.0, 0])            # (key, day) -> [sum, n]
    hr = {}                                          # day -> [min, max, sum, n]
    points = defaultdict(set)                        # key -> {(iso, value)}
    audio = defaultdict(lambda: [0.0, 0.0])          # (key, day) -> [sum(10^(L/10)*dur), sum(dur)]
    counts = defaultdict(int)                        # (key, day) -> n  (events)
    mindful = defaultdict(float)                     # day -> min
    sleep = []                                       # (start, end, stage, isWatch)
    rings = {}
    workouts = []
    sleep_goal = []
    sources = defaultdict(int)
    export_date = None
    me = {}

    depth_workout = 0
    depth_corr = 0
    ctx = etree.iterparse(open_xml(src), events=("start", "end"), huge_tree=True, resolve_entities=False, load_dtd=False)
    for ev, el in ctx:
        tag = el.tag
        if ev == "start":
            if tag == "Workout":
                depth_workout += 1
            elif tag == "Correlation":
                depth_corr += 1
            continue
        # ---- end events
        if depth_workout == 0 and depth_corr == 0:
            par = el.getparent()
            if par is not None and par.tag == "HealthData":
                while el.getprevious() is not None:
                    del par[0]
        if tag == "Record":
            if depth_workout:
                continue  # duplicates of top-level records
            a = el.attrib
            t = a.get("type")
            src_name = a.get("sourceName", "")
            sources[src_name] += 1
            s = a.get("startDate")
            if not s:
                el.clear(); continue
            st = ts(s)
            day = st.date().isoformat()
            unit = a.get("unit", "")
            v = a.get("value")
            if t in CUMULATIVE:
                k = CUMULATIVE[t]
                val = float(v) * UNIT_FIX.get((k, unit), 1)
                cum[(k, day, st.hour)][src_name] += val
            elif t in MEAN:
                k = MEAN[t]
                val = float(v) * UNIT_FIX.get((k, unit), 1)
                m = mean[(k, day)]; m[0] += val; m[1] += 1
            elif t == HK + "HeartRate":
                val = float(v)
                h = hr.get(day)
                if h is None:
                    hr[day] = [val, val, val, 1]
                else:
                    if val < h[0]: h[0] = val
                    if val > h[1]: h[1] = val
                    h[2] += val; h[3] += 1
            elif t in POINTS:
                k = POINTS[t]
                val = float(v) * UNIT_FIX.get((k, unit), 1)
                points[k].add((st.strftime("%Y-%m-%dT%H:%M"), round(val, 2)))
            elif t in AUDIO:
                k = AUDIO[t]
                en = ts(a["endDate"])
                dur = max((en - st).total_seconds(), 1.0)
                acc = audio[(k, day)]
                acc[0] += (10 ** (float(v) / 10)) * dur; acc[1] += dur
            elif t == "HKCategoryTypeIdentifierSleepAnalysis":
                stg = SLEEP_STAGE.get(v)
                if stg:
                    sleep.append((st, ts(a["endDate"]), stg, "Watch" in src_name))
            elif t == "HKCategoryTypeIdentifierHighHeartRateEvent":
                counts[("highHr", day)] += 1
            elif t == "HKCategoryTypeIdentifierLowHeartRateEvent":
                counts[("lowHr", day)] += 1
            elif t == "HKCategoryTypeIdentifierIrregularHeartRhythmEvent":
                counts[("irregular", day)] += 1
            elif t == "HKCategoryTypeIdentifierAudioExposureEvent":
                counts[("envEvent", day)] += 1
            elif t == "HKCategoryTypeIdentifierHeadphoneAudioExposureEvent":
                counts[("phoneEvent", day)] += 1
            elif t == "HKCategoryTypeIdentifierMindfulSession":
                mindful[day] += (ts(a["endDate"]) - st).total_seconds() / 60
            elif t == "HKDataTypeSleepDurationGoal":
                sleep_goal.append((day, float(v)))
            el.clear()
        elif tag == "Workout":
            depth_workout -= 1
            a = el.attrib
            st = ts(a["startDate"]); en = ts(a["endDate"])
            dur = float(a.get("duration", 0) or 0)
            if a.get("durationUnit") == "sec": dur /= 60
            if a.get("durationUnit") == "hr": dur *= 60
            w = {"d": st.strftime("%Y-%m-%dT%H:%M"), "type": wname(a["workoutActivityType"]),
                 "min": round(dur, 1), "src": a.get("sourceName", "")}
            for c in el:
                if c.tag == "WorkoutStatistics":
                    ct = c.get("type", "")
                    if ct.endswith("ActiveEnergyBurned") and c.get("sum"):
                        val = float(c.get("sum"))
                        if c.get("unit") == "kJ": val /= 4.184
                        w["kcal"] = round(val)
                    elif ct.endswith("HeartRate") and c.get("average"):
                        w["hr"] = round(float(c.get("average")))
                        if c.get("maximum"): w["hrMax"] = round(float(c.get("maximum")))
                    elif ("Distance" in ct) and c.get("sum"):
                        val = float(c.get("sum")); u = c.get("unit")
                        if u == "m": val /= 1000
                        elif u == "mi": val *= 1.609344
                        elif u == "yd": val *= 0.0009144
                        w["km"] = round(w.get("km", 0) + val, 2)
                elif c.tag == "MetadataEntry" and c.get("key") == "HKIndoorWorkout":
                    w["indoor"] = c.get("value") == "1"
            if "kcal" not in w and a.get("totalEnergyBurned"):
                w["kcal"] = round(float(a["totalEnergyBurned"]))
            if "km" not in w and a.get("totalDistance") and float(a["totalDistance"]) > 0:
                val = float(a["totalDistance"]); u = a.get("totalDistanceUnit")
                w["km"] = round(val * (1.609344 if u == "mi" else 0.001 if u == "m" else 1), 2)
            workouts.append(w)
            el.clear()
        elif tag == "Correlation":
            depth_corr -= 1
            for c in el:
                if c.tag == "Record" and c.get("type") in POINTS:
                    k = POINTS[c.get("type")]
                    points[k].add((ts(c.get("startDate")).strftime("%Y-%m-%dT%H:%M"), round(float(c.get("value")), 2)))
            el.clear()
        elif tag == "ActivitySummary":
            a = el.attrib
            d = a.get("dateComponents")
            if d:
                def f(x):
                    try: return float(a.get(x))
                    except (TypeError, ValueError): return None
                rings[d] = {"move": f("activeEnergyBurned"), "moveGoal": f("activeEnergyBurnedGoal"),
                            "exercise": f("appleExerciseTime"), "exerciseGoal": f("appleExerciseTimeGoal"),
                            "stand": f("appleStandHours"), "standGoal": f("appleStandHoursGoal")}
            el.clear()
        elif tag == "ExportDate":
            export_date = el.get("value"); el.clear()
        elif tag == "Me":
            me = dict(el.attrib); el.clear()
        elif depth_workout == 0 and depth_corr == 0 and tag not in ("MetadataEntry", "HealthData"):
            el.clear()

    # ---------------- assemble daily table
    daily = defaultdict(dict)
    agg = defaultdict(float)
    for (k, day, hour), bysrc in cum.items():
        agg[(k, day)] += max(bysrc.values())
    for (k, day), v in agg.items():
        daily[day][k] = v
    for (k, day), (s, n) in mean.items():
        daily[day][k] = s / n
    for day, (mn, mx, s, n) in hr.items():
        daily[day]["hrMin"] = mn; daily[day]["hrMax"] = mx; daily[day]["hrAvg"] = s / n
    for (k, day), (e, d) in audio.items():
        if d > 0: daily[day][k] = 10 * math.log10(e / d)
    for (k, day), n in counts.items():
        daily[day][k] = n
    for day, m in mindful.items():
        daily[day]["mindful"] = m
    for day, r in rings.items():
        # ActivitySummary rows exist for every calendar day since setup; keep only days with data
        if r["move"] is not None and (r["move"] > 0 or (r["exercise"] or 0) > 0 or (r["stand"] or 0) > 0):
            daily[day]["active"] = r["move"]
            daily[day]["exercise"] = r["exercise"]
            daily[day]["stand"] = r["stand"]
            if r["moveGoal"]: daily[day]["moveGoal"] = r["moveGoal"]
            if r["exerciseGoal"]: daily[day]["exerciseGoal"] = r["exerciseGoal"]
            if r["standGoal"]: daily[day]["standGoal"] = r["standGoal"]

    # ---------------- sleep: nights keyed by wake-up date
    # Prefer Apple Watch staged data; iPhone only records "In bed", which is not sleep.
    sl = sorted([x for x in sleep if x[3]], key=lambda x: x[0])
    sessions = []
    for st, en, stg, _ in sl:
        if sessions and st <= sessions[-1]["end"] + timedelta(minutes=60):
            s = sessions[-1]
            s["end"] = max(s["end"], en); s["seg"].append((st, en, stg))
        else:
            sessions.append({"start": st, "end": en, "seg": [(st, en, stg)]})

    def union_minutes(segs):
        segs = sorted(segs)
        tot = 0.0; cs = ce = None
        for a, b in segs:
            if cs is None: cs, ce = a, b
            elif a <= ce: ce = max(ce, b)
            else:
                tot += (ce - cs).total_seconds(); cs, ce = a, b
        if cs is not None: tot += (ce - cs).total_seconds()
        return tot / 60

    nights = {}
    for s in sessions:
        asleep_segs = [(a, b) for a, b, g in s["seg"] if g != "awake"]
        if not asleep_segs:
            continue
        asleep = union_minutes(asleep_segs)
        if asleep < 20:
            continue
        stages = {}
        for g in ("core", "deep", "rem", "unspec"):
            stages[g] = union_minutes([(a, b) for a, b, gg in s["seg"] if gg == g])
        awake = union_minutes([(a, b) for a, b, g in s["seg"] if g == "awake"])
        first = min(a for a, _ in asleep_segs); last = max(b for _, b in asleep_segs)
        wake_day = last.date()
        base = datetime.combine(wake_day, datetime.min.time())
        rec = {"asleep": asleep, "awake": awake, **stages,
               "bed": (first - base).total_seconds() / 60, "wake": (last - base).total_seconds() / 60,
               "sessions": 1}
        rec["mid"] = (rec["bed"] + rec["wake"]) / 2
        key = wake_day.isoformat()
        prev = nights.get(key)
        if prev is None:
            nights[key] = rec
        else:
            # second session on the same wake date (e.g. a nap): add durations,
            # timing stays with the longer session
            main, other = (prev, rec) if prev["asleep"] >= rec["asleep"] else (rec, prev)
            merged = dict(main)
            for g in ("asleep", "awake", "core", "deep", "rem", "unspec"):
                merged[g] = prev[g] + rec[g]
            merged["sessions"] = prev["sessions"] + 1
            nights[key] = merged
    for day, n in nights.items():
        for k in ("asleep", "awake", "core", "deep", "rem", "unspec", "bed", "wake", "mid"):
            daily[day]["sl_" + k] = n[k]
        daily[day]["sl_sessions"] = n["sessions"]

    # ---------------- columnar output
    days = sorted(daily)
    start = date.fromisoformat(days[0]); end = date.fromisoformat(days[-1])
    n = (end - start).days + 1
    keys = sorted({k for d in daily.values() for k in d})
    decimals = {"distance": 2, "cycling": 2, "doubleSupport": 4, "asymmetry": 4, "stairUp": 3, "stairDown": 3,
                "runStride": 3, "walkSpeed": 2, "runSpeed": 2, "resp": 2, "effort": 2}
    cols = {}
    for k in keys:
        arr = [None] * n
        dec = decimals.get(k, 1)
        for d, vals in daily.items():
            if k in vals and vals[k] is not None:
                arr[(date.fromisoformat(d) - start).days] = round(vals[k], dec)
        cols[k] = arr
    workouts.sort(key=lambda w: w["d"])
    data = {
        "meta": {"generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "exportDate": export_date,
                 "start": start.isoformat(), "end": end.isoformat(), "days": n,
                 "sources": {k: v for k, v in sorted(sources.items(), key=lambda x: -x[1])},
                 "dob": me.get("HKCharacteristicTypeIdentifierDateOfBirth"),
                 "sex": (me.get("HKCharacteristicTypeIdentifierBiologicalSex") or "").replace("HKBiologicalSex", ""),
                 "sleepGoal": sleep_goal},
        "daily": cols,
        "points": {k: sorted([list(p) for p in v]) for k, v in points.items()},
        "workouts": workouts,
    }
    with open(out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"days {n} ({start} to {end}), metrics {len(keys)}, workouts {len(workouts)}, nights {len(nights)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
