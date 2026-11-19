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
  checkValueType,
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
    // A cast to string works on an element that is not a choice; on a choice the engine keeps
    // the column's type (#156), so that cell is off.
    expect(check("code.text", { kind: "cast", to: "string" }, "t")).toEqual([]);
    expect(check("valueString", { kind: "cast", to: "string" }, "t")).toEqual([
      {
        code: TypeCode.TYPE_MISMATCH,
        severity: "error",
        field: "path",
        message:
          "R-001: column seen (dateTime) is written to Observation.valueString (string), a choice element, as a dateTime: the HL7 engine would make it a valueDateTime, not a valueString; write it to an element that is not a choice (#156)",
      },
    ]);
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

describe("cells the generator and the HL7 engine cannot write yet (#156)", () => {
  const SD = "http://hl7.org/fhir/StructureDefinition/";
  const sd = (
    name: string,
    kind: string,
    elements: Record<string, Record<string, unknown>>,
    extra = {},
  ) => ({
    resourceType: "StructureDefinition",
    id: name,
    url: `${SD}${name}`,
    name,
    type: name,
    kind,
    abstract: false,
    derivation: "specialization",
    snapshot: {
      element: Object.entries(elements).map(([path, f]) => ({
        id: path,
        path,
        min: 0,
        max: "1",
        ...f,
      })),
    },
    ...extra,
  });
  const typed = (...codes: string[]) => ({ type: codes.map((code) => ({ code })) });
  const engine = (() => {
    const index = buildIndex("4.0.1", [
      {
        id: "hl7.fhir.r4.core",
        version: "4.0.1",
        fhirVersions: ["4.0.1"],
        resources: [
          ...["string", "decimal", "dateTime", "date"].map((p) =>
            sd(p, "primitive-type", { [p]: {} }),
          ),
          sd("Quantity", "complex-type", { Quantity: {}, "Quantity.value": typed("decimal") }),
          sd(
            "Age",
            "complex-type",
            { Age: {}, "Age.value": typed("decimal") },
            { baseDefinition: `${SD}Quantity` },
          ),
          sd("Reference", "complex-type", {
            Reference: {},
            "Reference.reference": typed("string"),
          }),
          sd("Condition", "resource", {
            Condition: {},
            "Condition.onset[x]": typed("Age", "dateTime", "string"),
            "Condition.focus[x]": typed("Reference", "string"),
          }),
          sd("Thing", "resource", {
            Thing: {},
            "Thing.age": typed("Age"),
            "Thing.when": typed("dateTime"),
            "Thing.size": typed("Quantity"),
          }),
        ],
      },
    ]);
    if (!index.ok) throw new Error(JSON.stringify(index.issues));
    const opened = FhirDefinitions.open(index.value.manifest);
    if (!opened.ok) throw new Error("not opened");
    for (const [file, text] of index.value.files) opened.value.add(file, text);
    return opened.value;
  })();
  const cols = new Map<string, Column>([
    ["d", { id: "d", name: "seen", dataType: "date" }],
    ["n", { id: "n", name: "years", dataType: "decimal" }],
  ]);
  const ctx = { columns: cols, valueMaps: new Map<string, ValueMap>() };
  function on(type: string, path: string, transform: MappingRow["transform"], columnId?: string) {
    const resolved = resolvePath(engine, type, path);
    if (!resolved.ok) throw new Error(resolved.issue.message);
    const row: MappingRow = {
      id: "m",
      code: "R-001",
      instanceId: "i",
      path,
      transform,
      ...(columnId === undefined ? {} : { columnId }),
    };
    return checkRowTypes(engine, ctx, row, type, resolved.value).map((f) => [
      f.code,
      f.field,
      f.message,
    ]);
  }

  it("turns off a value whose type is not the choice's", () => {
    // date → dateTime is allowed by the table, but on a choice the engine would write onsetDate.
    expect(on("Condition", "onsetDateTime", { kind: "copy" }, "d")).toEqual([
      [
        "TYPE_MISMATCH",
        "path",
        "R-001: column seen (date) is written to Condition.onsetDateTime (dateTime), a choice element, as a date: the HL7 engine would make it an onsetDate, not an onsetDateTime; write it to an element that is not a choice (#156)",
      ],
    ]);
    expect(on("Thing", "when", { kind: "copy" }, "d")).toEqual([]);
    expect(
      on("Condition", "onsetDateTime", {
        kind: "constant",
        value: { type: "dateTime", value: "2023-05-04T10:00:00+02:00" },
      })[0]?.[0],
    ).toBe("TYPE_MISMATCH");
    expect(
      on("Thing", "when", {
        kind: "constant",
        value: { type: "dateTime", value: "2023-05-04T10:00:00+02:00" },
      }),
    ).toEqual([]);
    expect(
      on("Condition", "onsetString", { kind: "constant", value: { type: "string", value: "x" } }),
    ).toEqual([]);
  });

  it("turns off quantities into types derived from Quantity, and Quantity constants", () => {
    const age =
      "R-001: the quantity transform writes a Quantity, but Condition.onsetAge (Age) needs an Age, which the generator cannot create yet (#156)";
    expect(on("Condition", "onsetAge", { kind: "quantity" }, "n")).toEqual([
      ["TYPE_MISMATCH", "path", age],
    ]);
    expect(on("Thing", "age", { kind: "quantity" }, "n")[0]?.[0]).toBe("TYPE_MISMATCH");
    expect(on("Thing", "size", { kind: "quantity" }, "n")).toEqual([]);
    expect(
      on("Thing", "size", {
        kind: "constant",
        value: {
          type: "Quantity",
          value: 1,
          unit: { system: "http://unitsofmeasure.org", code: "mg" },
        },
      }),
    ).toEqual([
      [
        "TYPE_MISMATCH",
        "transform.value",
        "R-001: a Quantity constant cannot be written in the FML subset yet (#156)",
      ],
    ]);
  });

  it("turns off references into a choice element", () => {
    expect(on("Condition", "focusReference", { kind: "reference", targetInstanceId: "x" })).toEqual(
      [
        [
          "TYPE_MISMATCH",
          "path",
          "R-001: a reference cannot be written to Condition.focusReference (Reference), a choice element, yet (#156)",
        ],
      ],
    );
  });

  it("checks typed values the same way", () => {
    const resolved = (type: string, path: string) => {
      const r = resolvePath(engine, type, path);
      if (!r.ok) throw new Error(r.issue.message);
      return r.value;
    };
    const dateTime = { type: "dateTime", value: "2023-05-04T10:00:00+02:00" } as const;
    expect(
      checkValueType(
        engine,
        dateTime,
        "Condition",
        resolved("Condition", "onsetDateTime"),
        "fixed value",
      )?.message,
    ).toBe(
      "fixed value: the value is written to Condition.onsetDateTime (dateTime), a choice element, as a string: the HL7 engine would make it an onsetString, not an onsetDateTime; write it to an element that is not a choice (#156)",
    );
    expect(
      checkValueType(engine, dateTime, "Thing", resolved("Thing", "when"), "fixed value"),
    ).toBeUndefined();
    const quantity = {
      type: "Quantity",
      value: 1,
      unit: { system: "http://unitsofmeasure.org", code: "mg" },
    } as const;
    expect(
      checkValueType(engine, quantity, "Thing", resolved("Thing", "size"), "fixed value")?.message,
    ).toBe("fixed value: a Quantity value cannot be written in the FML subset yet (#156)");
  });
});
