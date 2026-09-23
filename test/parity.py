import json, sys
py = json.load(open(sys.argv[1])); js = json.load(open(sys.argv[2]))
bad = 0
def rep(*a):
    global bad; bad += 1
    if bad <= 40: print(*a)
for k in ("exportDate","start","end","days","dob","sex","sleepGoal","sources"):
    if py["meta"].get(k) != js["meta"].get(k): rep("meta", k, str(py["meta"].get(k))[:200], "|", str(js["meta"].get(k))[:200])
ks = set(py["daily"]) | set(js["daily"])
cells = 0
for k in sorted(ks):
    a = py["daily"].get(k); b = js["daily"].get(k)
    if a is None or b is None: rep("missing key", k, a is None, b is None); continue
    for i,(x,y) in enumerate(zip(a,b)):
        cells += 1
        if x != y: rep("daily", k, i, py["meta"]["start"], x, y)
for k in set(py["points"]) | set(js["points"]):
    if py["points"].get(k) != js["points"].get(k): rep("points", k, len(py["points"].get(k, [])), len(js["points"].get(k, [])))
if py["workouts"] != js["workouts"]:
    for i,(x,y) in enumerate(zip(py["workouts"], js["workouts"])):
        if x != y: rep("workout", i, x, y)
    if len(py["workouts"]) != len(js["workouts"]): rep("workout count", len(py["workouts"]), len(js["workouts"]))
print(f"compared {cells} daily cells, {sum(len(v) for v in py['points'].values())} points, {len(py['workouts'])} workouts -> {bad} differences")
