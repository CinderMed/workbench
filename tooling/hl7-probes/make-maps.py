#!/usr/bin/env python3
"""Writes the HL7 probe inputs: the logical model, the two rows and one map per case.

Run it again after changing NAMES or CASES, and commit the result. See README.md.
Usage: python3 tooling/hl7-probes/make-maps.py
"""
import json
import pathlib
import shutil

HERE = pathlib.Path(__file__).resolve().parent
BASE = "http://example.org/fhir/hl7-probes"

# Element names under test: the names of #134, one-letter and two-character controls, and the
# names the c-prefix rule gives for the rejected ones.
NAMES = ["a_b", "ab_c", "a__", "a1_b", "A_B", "x_", "_a", "a_", "aB_c", "c__mood",
         "a", "X", "ab", "a1",
         "ca_b", "cx_", "cc_a", "cc__mood"]

# Where the name appears: a FHIRPath `where` condition, a FHIRPath `evaluate` parameter (both bare
# and as a delimited identifier in backticks) and, as a control, an FML source path.
RULES = {
    "where": "  src where ($this.{ref}.exists()) -> bundle.entry as e, e.resource = create('Patient') as res then {{\n"
             "    src.pid as v -> res.id = v \"id\";\n  }} \"r\";\n",
    "evaluate": "  src -> bundle.entry as e, e.resource = create('Patient') as res, res.id = evaluate(src, $this.{ref}) \"r\";\n",
    "source": "  src.{ref} as v -> bundle.entry as e, e.resource = create('Patient') as res, res.id = v \"r\";\n",
}
CASES = [("where", False), ("where", True), ("evaluate", False), ("evaluate", True), ("source", False)]


def element(path, kind=None):
    e = {"id": path, "path": path, "definition": path, "min": 0, "max": "*" if kind is None else "1",
         "base": {"path": path, "min": 0, "max": "*" if kind is None else "1"}}
    if kind is not None:
        e["type"] = [{"code": kind}]
    return e


def main():
    elements = [element("Row")] + [element(f"Row.{n}", "string") for n in ["pid", *NAMES]]
    model = {"resourceType": "StructureDefinition", "id": "Row", "url": f"{BASE}/StructureDefinition/Row",
             "version": "0.1.0", "name": "Row", "status": "draft", "fhirVersion": "4.0.1", "kind": "logical",
             "abstract": False, "type": f"{BASE}/StructureDefinition/Row",
             "baseDefinition": "http://hl7.org/fhir/StructureDefinition/Element", "derivation": "specialization",
             "snapshot": {"element": elements}, "differential": {"element": elements}}
    write(HERE / "ig/StructureDefinition-Row.json", model)
    # Synthetic rows: every element has a value that is a valid FHIR id ("val<index>"), or none.
    row_type = f"{BASE}/StructureDefinition/Row"
    write(HERE / "rows/full.json", {"resourceType": row_type, "pid": "p1",
                                    **{n: f"val{i}" for i, n in enumerate(NAMES)}})
    write(HERE / "rows/empty.json", {"resourceType": row_type, "pid": "p1"})
    shutil.rmtree(HERE / "maps", ignore_errors=True)
    (HERE / "maps").mkdir()
    index = []
    for i, name in enumerate(NAMES):
        for rule, delimited in CASES:
            case = f"{rule}{'-delimited' if delimited else ''}"
            map_id = f"P{i:02d}{rule.capitalize()}{'D' if delimited else ''}"
            ref = f"`{name}`" if delimited else name
            text = (f'map "{BASE}/StructureMap/{map_id}" = `{map_id}`\n\n'
                    f'uses "{BASE}/StructureDefinition/Row" alias Row as source\n'
                    'uses "http://hl7.org/fhir/StructureDefinition/Bundle" alias Bundle as target\n'
                    'uses "http://hl7.org/fhir/StructureDefinition/Patient" alias Patient as target\n\n'
                    f"group {map_id}(source src : Row, target bundle : Bundle) {{\n"
                    "  src -> bundle.type = 'transaction' \"bundle-type\";\n"
                    + RULES[rule].format(ref=ref) + "}\n")
            (HERE / "maps" / f"{map_id}.map").write_text(text)
            index.append({"map": map_id, "name": name, "case": case, "expectedId": f"val{i}"})
    write(HERE / "cases.json", index)


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
