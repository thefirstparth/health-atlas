"""Synthetic Apple Health exports for robustness tests. All values are made up.
python3 test/make_fixtures.py test/fixtures"""
import sys, os, zipfile, random, io
from datetime import datetime, timedelta
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
random.seed(7)
HEAD = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 14 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord|Audiogram|VisionPrescription)*)>
<!ATTLIST HealthData locale CDATA #REQUIRED>
]>
<HealthData locale="en_US">
 <ExportDate value="%s +0100"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexFemale"/>
'''
def T(d): return d.strftime('%Y-%m-%d %H:%M:%S') + ' +0100'
def rec(t, src, unit, s, e, v, extra=''):
    return f' <Record type="{t}" sourceName="{src}" sourceVersion="1" unit="{unit}" creationDate="{T(e)}" startDate="{T(s)}" endDate="{T(e)}" value="{v}"{extra}/>\n'
Q = 'HKQuantityTypeIdentifier'

def iphone_only(days=40, imperial=False):
    d0 = datetime(2025, 3, 1); x = [HEAD % T(d0 + timedelta(days=days))]
    for i in range(days):
        day = d0 + timedelta(days=i)
        for h in (8, 12, 18):
            s = day + timedelta(hours=h); e = s + timedelta(minutes=20)
            x.append(rec(Q+'StepCount', 'Sam&apos;s iPhone', 'count', s, e, random.randint(300, 2500)))
            if imperial: x.append(rec(Q+'DistanceWalkingRunning', 'Sam&#8217;s iPhone', 'mi', s, e, round(random.uniform(.1, 1.2), 3)))
            else: x.append(rec(Q+'DistanceWalkingRunning', 'Sam&#8217;s iPhone', 'km', s, e, round(random.uniform(.2, 2), 3)))
        x.append(rec(Q+'WalkingSpeed', 'Sam’s iPhone', 'mi/hr' if imperial else 'km/hr', day+timedelta(hours=9), day+timedelta(hours=9, minutes=5), round(random.uniform(2.5, 3.5) if imperial else random.uniform(4, 5.5), 2)))
        if i % 7 == 0: x.append(rec(Q+'BodyMass', 'Health', 'lb' if imperial else 'kg', day+timedelta(hours=7), day+timedelta(hours=7), 160 + random.random() if imperial else 72 + random.random()))
    x.append('</HealthData>\n'); return ''.join(x)

def one_day():
    d0 = datetime(2026, 1, 5, 10); return HEAD % T(d0) + rec(Q+'StepCount', 'iPhone', 'count', d0, d0 + timedelta(minutes=5), 42) + '</HealthData>\n'

def watch(days=120):
    d0 = datetime(2025, 6, 1); x = [HEAD % T(d0 + timedelta(days=days))]
    for i in range(days):
        day = d0 + timedelta(days=i)
        if random.random() < .08: continue  # some days without the Watch
        for h in range(7, 22, 2):
            s = day + timedelta(hours=h); e = s + timedelta(minutes=30)
            x.append(rec(Q+'StepCount', 'Apple Watch', 'count', s, e, random.randint(200, 1400)))
            x.append(rec(Q+'StepCount', 'iPhone', 'count', s, e, random.randint(100, 1200)))
            x.append(rec(Q+'HeartRate', 'Apple Watch', 'count/min', s, s, random.randint(55, 140)))
        x.append(rec(Q+'RestingHeartRate', 'Apple Watch', 'count/min', day, day+timedelta(hours=23), random.randint(52, 66)))
        x.append(rec(Q+'HeartRateVariabilitySDNN', 'Apple Watch', 'ms', day+timedelta(hours=3), day+timedelta(hours=3, minutes=1), random.randint(25, 80)))
        x.append(rec(Q+'TimeInDaylight', 'Apple Watch', 'min', day+timedelta(hours=13), day+timedelta(hours=13, minutes=20), random.randint(5, 40)))
        # a night: bed ~23:30 the day before, wake ~07:00
        b = day - timedelta(minutes=random.randint(10, 90)); t = b
        for stg, mins in (('Core', 80), ('Deep', 45), ('Core', 60), ('REM', 30), ('Awake', 4), ('Core', 70), ('REM', 35), ('Core', random.randint(20, 90))):
            e = t + timedelta(minutes=mins)
            x.append(f' <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" sourceVersion="1" creationDate="{T(e)}" startDate="{T(t)}" endDate="{T(e)}" value="HKCategoryValueSleepAnalysisAsleep{stg}"/>\n'.replace('AsleepAwake', 'Awake'))
            t = e
        mv = random.randint(250, 800)
        x.append(f' <ActivitySummary dateComponents="{day:%Y-%m-%d}" activeEnergyBurned="{mv}" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="Cal" appleMoveTime="0" appleMoveTimeGoal="0" appleExerciseTime="{random.randint(5, 70)}" appleExerciseTimeGoal="30" appleStandHours="{random.randint(6, 14)}" appleStandHoursGoal="12"/>\n')
        if i % 3 == 0:
            s = day + timedelta(hours=18); e = s + timedelta(minutes=41)
            x.append(f''' <Workout workoutActivityType="HKWorkoutActivityType{random.choice(['Running', 'Cycling', 'Yoga', 'TraditionalStrengthTraining', 'Swimming'])}" duration="41" durationUnit="min" sourceName="Apple Watch" sourceVersion="1" creationDate="{T(e)}" startDate="{T(s)}" endDate="{T(e)}">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="{T(s)}" endDate="{T(e)}" sum="{random.randint(200, 500)}" unit="Cal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="{T(s)}" endDate="{T(e)}" average="{random.randint(110, 160)}" minimum="90" maximum="175" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="{T(s)}" endDate="{T(e)}" sum="{round(random.uniform(3, 9), 2)}" unit="km"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" startDate="{T(s)}" endDate="{T(s)}" value="999"/>
 </Workout>
''')
        if i % 30 == 5:
            x.append(f''' <Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="Omron" creationDate="{T(day)}" startDate="{T(day+timedelta(hours=8))}" endDate="{T(day+timedelta(hours=8))}">
  <Record type="HKQuantityTypeIdentifierBloodPressureSystolic" sourceName="Omron" unit="mmHg" startDate="{T(day+timedelta(hours=8))}" endDate="{T(day+timedelta(hours=8))}" value="{random.randint(112, 128)}"/>
  <Record type="HKQuantityTypeIdentifierBloodPressureDiastolic" sourceName="Omron" unit="mmHg" startDate="{T(day+timedelta(hours=8))}" endDate="{T(day+timedelta(hours=8))}" value="{random.randint(70, 84)}"/>
 </Correlation>
''')
    x.append('</HealthData>\n'); return ''.join(x)

BOMB = '''<?xml version="1.0"?>
<!DOCTYPE HealthData [
 <!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
 <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
 <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
 <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
 <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
 <!ENTITY f SYSTEM "file:///etc/passwd">
]>
<HealthData locale="en_US">
 <ExportDate value="2026-01-01 10:00:00 +0000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="&e;&f;" unit="count" startDate="2026-01-01 09:00:00 +0000" endDate="2026-01-01 09:10:00 +0000" value="100"/>
</HealthData>
'''
def zipit(name, xml, **kw):
    with zipfile.ZipFile(os.path.join(out, name), 'w', compression=kw.get('method', zipfile.ZIP_DEFLATED)) as z:
        with z.open('apple_health_export/export.xml', 'w', force_zip64=kw.get('zip64', False)) as f: f.write(xml.encode())
        z.writestr('apple_health_export/export_cda.xml', '<ClinicalDocument/>')
def zip_stream(name, xml):
    # written to a non-seekable stream -> local headers with data descriptors (as macOS Archive Utility does)
    class W(io.RawIOBase):
        def __init__(s): s.b = bytearray()
        def writable(s): return True
        def write(s, d): s.b += d; return len(d)
    w = W()
    with zipfile.ZipFile(w, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        with z.open('apple_health_export/export.xml', 'w') as f: f.write(xml.encode())
    open(os.path.join(out, name), 'wb').write(bytes(w.b))

W = watch()
zipit('watch.zip', W)
zipit('watch-stored.zip', W, method=zipfile.ZIP_STORED)
zipit('watch-zip64.zip', W, zip64=True)
zip_stream('watch-stream.zip', W)
open(os.path.join(out, 'watch.xml'), 'w').write(W)
zipit('iphone-only.zip', iphone_only())
zipit('iphone-imperial.zip', iphone_only(imperial=True))
zipit('one-day.zip', one_day())
zipit('entity-bomb.zip', BOMB)
with zipfile.ZipFile(os.path.join(out, 'not-health.zip'), 'w') as z: z.writestr('photos/readme.txt', 'hello')
open(os.path.join(out, 'not-a-zip.zip'), 'w').write('this is text')
print(sorted(os.listdir(out)))
