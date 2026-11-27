"""Golden check of time-zone/ (#107): the Bundle the HL7 engine produced from five rows written in
local Italian time must hold exactly these times, with their offsets. Usage:
python3 tests/time-zone.py <bundle.json>; prints one line.
"""
import json
import sys

bundle = json.load(open(sys.argv[1]))
observations = {}
patients = {e["resource"]["id"]: e["resource"]["identifier"][0]["value"] for e in bundle["entry"]
            if e["resource"]["resourceType"] == "Patient"}
for e in bundle["entry"]:
    r = e["resource"]
    if r["resourceType"] == "Observation":
        observations[patients[r["subject"]["reference"].split("/")[1]]] = r

MISSING = "(missing)"
# (patient, element, expected): Europe/Rome from the table; the note time from a column in UTC.
CELLS = [
    ("P-001", "effectiveDateTime", "2025-01-15T10:00:00+01:00"),  # winter
    ("P-002", "effectiveDateTime", "2025-07-15T10:00:00+02:00"),  # summer
    ("P-003", "effectiveDateTime", "2025-10-26T02:30:00+02:00"),  # repeated hour: the earlier offset
    ("P-004", "effectiveDateTime", "2025-10-26T03:00:00+01:00"),  # after the change
    ("P-005", "effectiveDateTime", MISSING),  # skipped hour: an invalid value, dropped (report-drop)
    ("P-001", "note.time", "2025-01-15T09:05:00+00:00"),  # the column's own zone (Z) over the table's
    ("P-005", "note.time", "2025-03-30T00:35:00+00:00"),
]

failed = []
for patient, element, expected in CELLS:
    r = observations.get(patient, {})
    actual = (r.get("note") or [{}])[0].get("time", MISSING) if element == "note.time" else r.get(element, MISSING)
    if actual != expected:
        failed.append(f"{patient} {element}: {json.dumps(actual)}, expected {json.dumps(expected)}")
if failed:
    print("FAILED time zone: " + "; ".join(failed))
    sys.exit(1)
print(f"OK time zone: {len(CELLS)} of {len(CELLS)} values as expected")
