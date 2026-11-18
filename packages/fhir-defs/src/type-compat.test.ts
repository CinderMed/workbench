import type { Column, Instance, MappingRow, ProjectFile, ValueMap } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { resolvePath } from "./element-tree.js";
import { FHIR, r4Paths } from "./test-support/synthetic-packages.js";
import {
  TypeCode,
  castAllowed,
  checkRowTypes,
  copyVerdict,
  fhirType,
  isQuantity,
  valueVerdict,
} from "./type-compat.js";
import { validateFhir } from "./validate-fhir.js";

const defs = (() => {
  const index = buildIndex("4.0.1", [r4Paths()]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  for (const [file, text] of index.value.files) opened.value.add(file, text);
  return opened.value;
})();

const columns: [Column, ...Column[]] = [
  { id: "s", name: "note", dataType: "string" },
  { id: "i", name: "score", dataType: "integer" },
  { id: "d", name: "weight", dataType: "decimal" },
  { id: "b", name: "smoker", dataType: "boolean" },
  { id: "c", name: "answer", dataType: "categorical" },
  { id: "m", name: "sites", dataType: "multipleChoice" },
  { id: "t", name: "seen", dataType: "dateTime" },
];
const valueMaps: ValueMap[] = [
  {
    id: "vm",
    name: "answers",
    target: "CodeableConcept",
    entries: [{ sourceValue: "a", action: { kind: "absent" } }],
  },
];
const context = {
  columns: new Map(columns.map((c) => [c.id, c])),
  valueMaps: new Map(valueMaps.map((m) => [m.id, m])),
};

function check(path: string, transform: MappingRow["transform"], columnId?: string) {
  const resolved = resolvePath(defs, "Observation", path);
  if (!resolved.ok) throw new Error(resolved.issue.message);
  const row: MappingRow = {
    id: "map",
    code: "R-001",
    instanceId: "ins",
    path,
    transform,
    ...(columnId === undefined ? {} : { columnId }),
  };
  return checkRowTypes(defs, context, row, "Observation", resolved.value);
}

describe("verdicts", () => {
  it("knows the system types, Quantity and its derivations, and casts", () => {
    expect(fhirType("http://hl7.org/fhirpath/System.String")).toBe("string");
    expect(fhirType("CodeableConcept")).toBe("CodeableConcept");
    expect(isQuantity(defs, "Quantity")).toBe(true);
    expect(isQuantity(defs, `${FHIR}SimpleQuantity`)).toBe(true);
    expect(isQuantity(defs, "Coding")).toBe(false);
    expect(castAllowed("categorical", "string")).toBe(true);
    expect(castAllowed("integer", "decimal")).toBe(true);
    expect(castAllowed("decimal", "integer")).toBe(false);
    expect(copyVerdict(defs, "integer", "integer64")).toEqual({ kind: "ok" });
    expect(copyVerdict(defs, "dateTime", "date")).toEqual({
      kind: "mismatch",
      why: "the time would be lost",
    });
    expect(
      valueVerdict(
        defs,
        { type: "Quantity", value: 1, unit: { system: "http://unitsofmeasure.org", code: "mg" } },
        `${FHIR}SimpleQuantity`,
      ),
    ).toEqual({ kind: "ok" });
  });
});

describe("checkRowTypes", () => {
  it("accepts compatible rows", () => {
    expect(check("code.text", { kind: "copy" }, "s")).toEqual([]);
    expect(check("component[a].valueInteger", { kind: "copy" }, "i")).toEqual([]);
    expect(check("valueQuantity", { kind: "quantity" }, "d")).toEqual([]);
    expect(check("code", { kind: "valueMap", valueMapId: "vm" }, "c")).toEqual([]);
    expect(check("subject", { kind: "reference", targetInstanceId: "x" })).toEqual([]);
    expect(check("valueString", { kind: "concat", columnIds: ["s", "i"] })).toEqual([]);
    // Missing columns and value maps are integrity errors (rule 1), not type errors.
    expect(check("valueString", { kind: "copy" }, "nothing")).toEqual([]);
    expect(check("code", { kind: "valueMap", valueMapId: "nothing" })).toEqual([]);
  });

  it("warns about copies that may give invalid values", () => {
    expect(check("status", { kind: "copy" }, "s")).toEqual([
      {
        code: TypeCode.TYPE_PRECISION,
        severity: "warning",
        field: "path",
        message:
          "R-001: column note (string) is written to Observation.status (code): the value must have the format of code",
      },
    ]);
  });

  it("names the transform a row needs, and the concrete choice that fits", () => {
    expect(check("component[a].valueQuantity", { kind: "copy" }, "i")).toEqual([
      {
        code: TypeCode.TYPE_NEEDS_TRANSFORM,
        severity: "error",
        field: "transform",
        message:
          "R-001: column score (integer) needs the quantity transform (with a unit) to be written to Observation.component[a].valueQuantity (Quantity); use component[a].valueInteger",
      },
    ]);
    expect(check("code", { kind: "copy" }, "m")[0]?.message).toBe(
      "R-001: column sites (multipleChoice) needs a value map with repeat eachValue to be written to Observation.code (CodeableConcept)",
    );
    expect(check("valueBoolean", { kind: "copy" }, "c")[0]?.code).toBe(
      TypeCode.TYPE_NEEDS_TRANSFORM,
    );
  });

  it("lists the elements of a complex type a column fits", () => {
    expect(check("code", { kind: "copy" }, "s")).toEqual([
      {
        code: TypeCode.COMPLEX_TARGET,
        severity: "error",
        field: "path",
        message:
          "R-001: column note (string) cannot be copied to Observation.code (CodeableConcept), a complex type: use one of its elements: code.text",
      },
    ]);
    expect(check("subject", { kind: "copy" }, "b")[0]?.message).toBe(
      "R-001: column smoker (boolean) cannot be copied to Observation.subject (Reference), a complex type: no element of Reference takes a boolean value",
    );
  });

  it("explains mismatches", () => {
    expect(check("valueBoolean", { kind: "copy" }, "d")).toEqual([
      {
        code: TypeCode.TYPE_MISMATCH,
        severity: "error",
        field: "path",
        message:
          "R-001: column weight (decimal) cannot be written to Observation.valueBoolean (boolean)",
      },
    ]);
    expect(check("component[a].valueInteger", { kind: "copy" }, "d")[0]?.message).toBe(
      "R-001: column weight (decimal) cannot be written to Observation.component[a].valueInteger (integer): an integer would lose the decimals",
    );
  });

  it("checks casts: the conversion, then its output", () => {
    expect(check("valueString", { kind: "cast", to: "integer" }, "s")).toEqual([
      {
        code: TypeCode.TYPE_MISMATCH,
        severity: "error",
        field: "transform.to",
        message:
          "R-001: column note (string) cannot be converted to integer: a conversion goes to string, to the same type, from integer to decimal or from date to dateTime",
      },
    ]);
    expect(check("valueString", { kind: "cast", to: "string" }, "t")).toEqual([]);
    expect(check("valueBoolean", { kind: "cast", to: "string" }, "t")[0]?.message).toBe(
      "R-001: column seen converted to string cannot be written to Observation.valueBoolean (boolean); use valueString",
    );
  });

  it("checks value maps, quantities, concatenations, constants, references and expressions", () => {
    expect(check("valueString", { kind: "valueMap", valueMapId: "vm" }, "c")[0]?.message).toBe(
      "R-001: value map answers gives CodeableConcept, but the element is Observation.valueString (string)",
    );
    expect(
      check("valueString", { kind: "quantity" }, "s").map((f) => [f.field, f.message]),
    ).toEqual([
      [
        "columnId",
        "R-001: the quantity transform needs an integer or decimal column, not note (string)",
      ],
      [
        "path",
        "R-001: the quantity transform gives a Quantity, but the element is Observation.valueString (string); use valueQuantity",
      ],
    ]);
    expect(
      check("valueBoolean", { kind: "concat", columnIds: ["s", "b"] }).map((f) => [
        f.field,
        f.message,
      ]),
    ).toEqual([
      [
        "transform.columnIds.1",
        "R-001: a concatenation takes string, categorical, integer or decimal columns, not smoker (boolean)",
      ],
      [
        "path",
        "R-001: a concatenation gives a string, but the element is Observation.valueBoolean (boolean); use valueString",
      ],
    ]);
    expect(
      check("valueString", { kind: "constant", value: { type: "boolean", value: true } }),
    ).toEqual([
      {
        code: TypeCode.TYPE_MISMATCH,
        severity: "error",
        field: "transform.value",
        message:
          "R-001: the constant is a boolean, but the element is Observation.valueString (string); use valueBoolean",
      },
    ]);
    expect(check("code", { kind: "reference", targetInstanceId: "x" })[0]?.message).toBe(
      "R-001: a reference needs a Reference element, but the element is Observation.code (CodeableConcept)",
    );
    expect(check("code", { kind: "expression", language: "fml", expression: "x" })).toEqual([
      {
        code: TypeCode.EXPRESSION_NOT_TYPE_CHECKED,
        severity: "warning",
        field: "transform",
        message: "R-001: an expert expression is not type-checked, only by the grammar",
      },
    ]);
  });
});

describe("validateFhir, types", () => {
  const observation: Instance = {
    id: "ins",
    resourceType: "Observation",
    index: 0,
    sourceId: "src",
    multiplicity: { kind: "perRow" },
    fixedValues: [{ path: "status", value: { type: "string", value: "final" } }],
    slices: [
      {
        id: "sl",
        path: "component",
        name: "nrs",
        discriminator: [{ path: "code", value: { type: "code", value: "x" } }],
      },
    ],
  };
  const project: ProjectFile = {
    formatVersion: "1.3.0",
    project: { id: "prj", name: "T", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
    sources: [{ id: "src", name: "T", columns }],
    instances: [observation],
    mappings: [
      {
        id: "m1",
        code: "R-001",
        instanceId: "ins",
        columnId: "b",
        path: "valueBoolean",
        transform: { kind: "copy" },
      },
      {
        id: "m2",
        code: "R-002",
        instanceId: "ins",
        columnId: "c",
        path: "code",
        transform: { kind: "valueMap", valueMapId: "vm2" },
      },
    ],
    valueMaps: [
      {
        id: "vm2",
        name: "codes",
        target: "CodeableConcept",
        entries: [
          {
            sourceValue: "x",
            action: {
              kind: "setElement",
              set: [{ path: "status", value: { type: "boolean", value: true } }],
            },
          },
        ],
      },
    ],
  };

  it("checks fixed values, discriminators and value actions like constants, on their own field", () => {
    expect(
      validateFhir(project, defs).map((r) => [r.code, r.objectKind, r.field, r.message]),
    ).toEqual([
      [
        "TYPE_MISMATCH",
        "instance",
        "slices.0.discriminator.0.value",
        "discriminator of slice component[nrs]: the value is a code, but the element is Observation.component[nrs].code (CodeableConcept)",
      ],
      [
        "TYPE_MISMATCH",
        "instance",
        "fixedValues.0.value",
        "fixed value: the value is a string, but the element is Observation.status (code)",
      ],
      [
        "TYPE_MISMATCH",
        "valueMap",
        "entries.0.action.set.0.value",
        "value map codes (used by R-002): the value is a boolean, but the element is Observation.status (code)",
      ],
    ]);
  });
});
