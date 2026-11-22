"""Golden check of r5-visit/ (#78): the R5 Bundle the HL7 engine produced must hold exactly these
values, with these JSON types (a value of the wrong type can still be valid FHIR). Usage:
python3 tests/r5-visit.py <bundle.json>; prints one line.
"""
import json
import sys

text = open(sys.argv[1]).read()
bundle = json.loads(text)
by_type = {e["resource"]["resourceType"]: e["resource"] for e in bundle["entry"]}


def get(resource, path):
    value = by_type[resource]
    for part in path:
        value = value[part]
    return value


# (check, resource type, path in the resource, expected value)
CELLS = [
    ("copy string → identifier.value", "Patient", ["identifier", 0, "value"], "R5-001"),
    ("value map → code (R5 ConceptMap exported)", "Patient", ["gender"], "female"),
    ("coding → Encounter.class, a CodeableConcept list in R5", "Encounter", ["class", 0, "coding", 0, "code"], "AMB"),
    ("cast date → dateTime on Encounter.actualPeriod.start (R5)", "Encounter", ["actualPeriod", "start"], "2024-03-12"),
    ("reference", "Encounter", ["subject", "reference"], "Patient/pat-7bb90cd39f4cc90d32539d2b"),
    ("quantity → valueQuantity (choice)", "Observation", ["valueQuantity", "code"], "kg"),
    ("constant dateTime with offset (choice)", "Observation", ["effectiveDateTime"], "2024-03-12T09:30:00+01:00"),
    ("cast decimal → string (choice), trailing zeros kept", "Observation", ["component", 0, "valueString"], "1.50"),
    ("copy integer → integer (choice)", "Observation", ["component", 1, "valueInteger"], 6),
    ("fixed clinicalStatus (required in R5)", "Condition", ["clinicalStatus", "coding", 0, "code"], "active"),
    ("quantity → Age (choice)", "Condition", ["onsetAge", "value"], 58),
    ("quantity → Age unit", "Condition", ["onsetAge", "code"], "a"),
]

failed = []
for name, resource, path, expected in CELLS:
    try:
        actual = get(resource, path)
    except (KeyError, IndexError, TypeError):
        actual = "(missing)"
    if actual != expected or type(actual) is not type(expected):
        failed.append(f"{name}: {json.dumps(actual)}, expected {json.dumps(expected)}")
# A decimal keeps its digits: 72.40 in the Bundle text, not 72.4.
if '"value" : 72.40' not in text:
    failed.append("valueQuantity.value: the digits of 72.40 are not kept")
if failed:
    print("FAILED r5 visit: " + "; ".join(failed))
    sys.exit(1)
print(f"OK r5 visit: {len(CELLS) + 1} of {len(CELLS) + 1} values as expected")
