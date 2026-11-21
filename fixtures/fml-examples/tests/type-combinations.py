"""Golden check of type-combinations/ (#153): every type combination the example covers must give
exactly this value, with this JSON type, in the Bundle the HL7 engine produced. Bundle validation
alone is not enough: a value of the wrong type can still be valid FHIR (valueInteger instead of
valueString on a choice). Usage: python3 tests/type-combinations.py <bundle.json>; prints one line.
"""
import json
import sys

bundle = json.load(open(sys.argv[1]))
by_id = {e["resource"]["id"].split("-ac1")[0]: e["resource"] for e in bundle["entry"]}


def get(resource, path):
    value = by_id[resource]
    for part in path:
        value = value[part]
    return value


# (combination, resource id prefix, path in the resource, expected value)
CELLS = [
    ("copy string → string", "pat", ["identifier", 0, "value"], "P-100"),
    ("copy string → uri", "pat", ["identifier", 0, "system"], "urn:example:patients"),
    ("copy string → code", "pat", ["language"], "it"),
    ("copy string → id", "pat", ["meta", "versionId"], "1"),
    ("copy string → canonical", "pat", ["meta", "profile", 0], "http://hl7.org/fhir/StructureDefinition/Patient"),
    ("copy string → url", "pat", ["photo", 0, "url"], "https://cindermed.org/photo.png"),
    ("copy integer → unsignedInt", "pat", ["photo", 0, "size"], 1024),
    ("constant string", "pat", ["name", 0, "text"], "Test Patient"),
    ("constant boolean", "pat", ["active"], True),
    ("constant integer (choice)", "pat", ["multipleBirthInteger"], 1),
    ("constant date", "pat", ["birthDate"], "1980-01-01"),
    ("copy categorical → code", "obs-weight", ["status"], "final"),
    ("copy categorical → string", "obs-weight", ["code", "text"], "weight"),
    ("copy integer → decimal", "loc", ["position", "longitude"], 72),
    ("cast integer → decimal", "loc", ["position", "latitude"], 90),
    ("constant decimal", "loc", ["position", "altitude"], 0.25),
    ("cast integer → string", "loc", ["name"], "42"),
    ("cast decimal → string", "loc", ["description"], "0.75"),
    ("cast boolean → string", "loc", ["alias", 0], "true"),
    ("cast decimal → decimal", "risk", ["prediction", 0, "relativeRisk"], 0.75),
    ("cast date → string", "risk", ["mitigation"], "2023-05-04"),
    ("quantity integer → Quantity (choice)", "obs-panel", ["valueQuantity", "value"], 180),
    ("quantity unit", "obs-panel", ["valueQuantity", "code"], "cm"),
    ("cast categorical → string (choice)", "obs-panel", ["component", 0, "valueString"], "weight"),
    ("cast string → string (choice)", "obs-panel", ["component", 1, "valueString"], "free text"),
    ("cast integer → integer (choice)", "obs-panel", ["component", 2, "valueInteger"], 42),
    ("cast boolean → boolean (choice)", "obs-panel", ["component", 3, "valueBoolean"], True),
    ("cast dateTime → dateTime (choice)", "obs-panel", ["component", 4, "valueDateTime"], "2023-05-04"),
    ("copy integer → positiveInt", "enc", ["diagnosis", 0, "rank"], 2),
    ("quantity decimal → SimpleQuantity", "disp", ["quantity", "value"], 50.5),
    ("coding → CodeableConcept (choice)", "obs-weight", ["valueCodeableConcept", "coding", 0, "code"], "123"),
    ("coding system", "obs-weight", ["valueCodeableConcept", "coding", 0, "system"], "https://cindermed.org/fhir/CodeSystem/type-combinations-findings"),
    ("coding display column", "obs-weight", ["valueCodeableConcept", "coding", 0, "display"], "Elevated weight"),
    ("coding → Coding", "enc", ["class", "code"], "AMB"),
    ("coding → Coding system", "enc", ["class", "system"], "http://terminology.hl7.org/CodeSystem/v3-ActCode"),
    ("copy dateTime → dateTime (choice)", "imm", ["occurrenceDateTime"], "2023-04-01"),
    ("constant dateTime", "imm", ["recorded"], "2023-05-04T10:00:00+02:00"),
    ("cast dateTime → string", "imm", ["lotNumber"], "2023-05-04"),
    # Choice elements written with the chosen type (#156, ADR-0023): create('<type>').
    ("cast decimal → string (choice), trailing zeros kept", "obs-panel", ["component", 5, "valueString"], "1.50"),
    ("cast date → string (choice)", "obs-panel", ["component", 6, "valueString"], "2023-05-04"),
    ("cast integer → string (choice)", "obs-panel", ["component", 7, "valueString"], "42"),
    ("cast boolean → string (choice)", "obs-panel", ["component", 8, "valueString"], "true"),
    ("copy date → dateTime (choice)", "obs-weight", ["effectiveDateTime"], "2023-05-04"),
    ("constant dateTime with offset (choice)", "obs-panel", ["effectiveDateTime"], "2023-05-04T10:30:00+02:00"),
    ("fixed dateTime with offset (choice)", "risk", ["occurrenceDateTime"], "2023-05-04T10:30:00+02:00"),
    ("quantity → Age (choice)", "cond", ["onsetAge", "value"], 47),
    ("quantity → Age unit", "cond", ["onsetAge", "code"], "a"),
    ("quantity → Quantity, not a choice (doseQuantity)", "imm", ["doseQuantity", "value"], 2),
    ("copy integer → positiveInt (choice)", "imm", ["protocolApplied", 0, "doseNumberPositiveInt"], 2),
    ("path through a choice: valueQuantity.value", "obs-through", ["valueQuantity", "value"], 72),
    ("path through a choice: valueQuantity.code", "obs-through", ["valueQuantity", "code"], "kg"),
]

failed = []
for name, resource, path, expected in CELLS:
    try:
        actual = get(resource, path)
    except (KeyError, IndexError, TypeError):
        actual = "(missing)"
    # Same value and same JSON type: 1 is not "1", true is not "true", 72 is not 72.0 only by type.
    if actual != expected or type(actual) is not type(expected):
        failed.append(f"{name}: {json.dumps(actual)}, expected {json.dumps(expected)}")
if failed:
    print("FAILED type combinations: " + "; ".join(failed))
    sys.exit(1)
print(f"OK type combinations: {len(CELLS)} of {len(CELLS)} values as expected")
