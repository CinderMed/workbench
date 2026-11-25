"""Golden check of concatenation/ (#98): the Bundles the HL7 engine produced from three rows (all
columns, some empty, all empty) must hold exactly these strings. Usage:
python3 tests/concatenation.py <folder with bundle-visit-*.json>; prints one line.
"""
import json
import sys

folder = sys.argv[1]
MISSING = "(missing)"


def values(row):
    text = open(f"{folder}/bundle-visit-{row}.json").read()
    by_type = {e["resource"]["resourceType"]: e["resource"] for e in json.loads(text)["entry"]}
    patient, obs = by_type["Patient"], by_type["Observation"]
    return {
        "name.text": (patient.get("name") or [{}])[0].get("text", MISSING),
        "valueString": obs.get("valueString", MISSING),
        "note.text": (obs.get("note") or [{}])[0].get("text", MISSING),
    }


# (row, element, expected): categorical + string in a shared block, integers on a choice,
# decimal + string on markdown with a separator that holds a quote.
CELLS = [
    ("full", "name.text", "Dr Anna Rossi"),
    ("full", "valueString", "120/80"),
    ("full", "note.text", "1.50' · 'stable"),
    # Empty columns are skipped, with their separators.
    ("partial", "name.text", "Luca"),
    ("partial", "valueString", "120"),
    ("partial", "note.text", "dell'orto"),
    # All columns empty: no element at all, not an empty string.
    ("empty", "name.text", MISSING),
    ("empty", "valueString", MISSING),
    ("empty", "note.text", MISSING),
]

failed = []
found = {row: values(row) for row in ("full", "partial", "empty")}
for row, element, expected in CELLS:
    actual = found[row][element]
    if actual != expected:
        failed.append(f"{row} {element}: {json.dumps(actual)}, expected {json.dumps(expected)}")
if failed:
    print("FAILED concatenation: " + "; ".join(failed))
    sys.exit(1)
print(f"OK concatenation: {len(CELLS)} of {len(CELLS)} values as expected")
