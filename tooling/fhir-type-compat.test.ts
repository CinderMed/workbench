// Type compatibility (D7) on the real core packages, R4 4.0.1 and R5 5.0.0: every cell of the
// specification's tables ("Type compatibility in the grid"), on a real element of each type. The
// expected outcomes are written here from the specification, independently of the code's table.
// Runs when FHIR_CORE_PACKAGES=1 (the Unit tests job in CI).
import type { Column, FhirValue, MappingRow, ValueMap } from "../packages/model/dist/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";
import {
  type FhirDefinitions,
  checkRowTypes,
  resolvePath,
} from "../packages/fhir-defs/dist/index.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";

/** A real element of each type, the same path in R4 and R5. */
const ELEMENTS: Record<string, [string, string]> = {
  string: ["Patient", "name.family"],
  markdown: ["Observation", "note.text"],
  code: ["Patient", "gender"],
  id: ["Patient", "meta.versionId"],
  uri: ["Patient", "identifier.system"],
  url: ["Endpoint", "address"],
  canonical: ["Patient", "meta.profile"],
  integer: ["Observation", "valueInteger"],
  positiveInt: ["Observation", "valueSampledData.dimensions"],
  unsignedInt: ["ImagingStudy", "numberOfSeries"],
  decimal: ["Observation", "valueQuantity.value"],
  boolean: ["Patient", "active"],
  date: ["Patient", "birthDate"],
  dateTime: ["Observation", "effectiveDateTime"],
  instant: ["Observation", "issued"],
  time: ["Observation", "valueTime"],
  Quantity: ["Observation", "valueQuantity"],
  Age: ["Condition", "onsetAge"],
  Duration: ["MedicationRequest", "dispenseRequest.expectedSupplyDuration"],
  SimpleQuantity: ["Observation", "referenceRange.low"],
  Coding: ["Observation", "code.coding"],
  CodeableConcept: ["Observation", "code"],
  HumanName: ["Patient", "name"],
  Identifier: ["Patient", "identifier"],
  Period: ["Condition", "onsetPeriod"],
  Reference: ["Observation", "subject"],
};
const QUANTITIES = ["Quantity", "Age", "Duration", "SimpleQuantity"];
const COMPLEX = [
  "Coding",
  "CodeableConcept",
  "HumanName",
  "Identifier",
  "Period",
  "Reference",
  ...QUANTITIES,
];

type Outcome =
  "ok" | "TYPE_PRECISION" | "TYPE_NEEDS_TRANSFORM" | "COMPLEX_TARGET" | "TYPE_MISMATCH";

/** The specification's "Direct copy" table: allowed, allowed with a warning, needs a transform. */
const COPY: Record<Column["dataType"], { ok: string[]; warn: string[]; transform: string[] }> = {
  string: {
    ok: ["string", "markdown"],
    warn: ["code", "id", "uri", "url", "canonical"],
    transform: [],
  },
  integer: {
    ok: ["integer"],
    warn: ["positiveInt", "unsignedInt", "decimal"],
    transform: [...QUANTITIES, "string", "markdown"],
  },
  decimal: { ok: ["decimal"], warn: [], transform: [...QUANTITIES, "string", "markdown"] },
  boolean: {
    ok: ["boolean"],
    warn: [],
    transform: ["code", "string", "Coding", "CodeableConcept"],
  },
  date: { ok: ["date", "dateTime"], warn: [], transform: ["string", "markdown"] },
  dateTime: { ok: ["dateTime"], warn: [], transform: ["string", "markdown"] },
  categorical: {
    ok: [],
    warn: ["code", "string"],
    transform: ["Coding", "CodeableConcept", "boolean"],
  },
  multipleChoice: { ok: [], warn: [], transform: Object.keys(ELEMENTS) },
};

/**
 * What the generator and the HL7 engine can write today (#156): on a choice element the engine
 * takes the type of the value written (the column's type in the logical model, or the literal's),
 * so a cell the table allows is off when that type is not the chosen one; quantities into types
 * derived from Quantity, and Quantity constants, are off too.
 */
const CHOICE_ELEMENTS = new Set(["integer", "dateTime", "time", "Quantity", "Age", "Period"]);
const DERIVED_QUANTITIES = new Set(["Age", "Duration"]);
const WRITTEN: Record<Column["dataType"], string> = {
  string: "string",
  integer: "integer",
  decimal: "decimal",
  boolean: "boolean",
  date: "date",
  dateTime: "dateTime",
  categorical: "string",
  multipleChoice: "string",
};
function engine(allowed: Outcome, type: string, written: string): Outcome {
  if (allowed !== "ok" && allowed !== "TYPE_PRECISION") return allowed;
  return CHOICE_ELEMENTS.has(type) && written !== type ? "TYPE_MISMATCH" : allowed;
}

function expectedCopy(column: Column["dataType"], type: string): Outcome {
  const rule = COPY[column];
  const allowed: Outcome = rule.ok.includes(type)
    ? "ok"
    : rule.warn.includes(type)
      ? "TYPE_PRECISION"
      : rule.transform.includes(type)
        ? "TYPE_NEEDS_TRANSFORM"
        : COMPLEX.includes(type)
          ? "COMPLEX_TARGET"
          : "TYPE_MISMATCH";
  return engine(allowed, type, WRITTEN[column]);
}

const column = (dataType: Column["dataType"]): Column => ({ id: "col", name: "c", dataType });
function row(transform: MappingRow["transform"]): MappingRow {
  return { id: "map", code: "R-001", instanceId: "ins", columnId: "col", path: "x", transform };
}
const valueMap = (target: ValueMap["target"]): ValueMap => ({
  id: "vm",
  name: "m",
  target,
  entries: [{ sourceValue: "a", action: { kind: "absent" } }],
});

describe.runIf(enabled).each(["4.0.1", "5.0.0"])("type compatibility in FHIR %s", (fhirVersion) => {
  let defs: FhirDefinitions;
  beforeAll(async () => {
    defs = (await loadDefinitions(fhirVersion, [], { offline: true })).definitions;
  }, 300_000);

  /** The outcome of a row on the real element of a type: "ok" or the first finding's code. */
  function outcome(
    type: string,
    transform: MappingRow["transform"],
    dataType: Column["dataType"] = "string",
    map?: ValueMap,
  ): Outcome {
    const [resource, path] = ELEMENTS[type] ?? ["", ""];
    const resolved = resolvePath(defs, resource, path);
    if (!resolved.ok) throw new Error(`${resource}.${path}: ${resolved.issue.message}`);
    const findings = checkRowTypes(
      defs,
      {
        columns: new Map([["col", column(dataType)]]),
        valueMaps: new Map(map === undefined ? [] : [["vm", map]]),
      },
      row(transform),
      resource,
      resolved.value,
    );
    return (findings[0]?.code as Outcome | undefined) ?? "ok";
  }

  it("finds a real element of each type", () => {
    for (const [type, [resource, path]] of Object.entries(ELEMENTS)) {
      const resolved = resolvePath(defs, resource, path);
      if (!resolved.ok) throw new Error(`${resource}.${path}: ${resolved.issue.message}`);
      const codes = resolved.value.types.map((t) =>
        t.code.replace("http://hl7.org/fhirpath/System.String", "string"),
      );
      const profiles = resolved.value.types.flatMap((t) => t.profile ?? []);
      expect(
        [...codes, ...profiles.map((p) => p.split("/").at(-1))],
        `${resource}.${path}`,
      ).toContain(type);
    }
  });

  const columns = Object.keys(COPY) as Column["dataType"][];
  it.each(columns.flatMap((c) => Object.keys(ELEMENTS).map((t) => [c, t] as const)))(
    "copy: %s column → %s",
    (dataType, type) => {
      expect(outcome(type, { kind: "copy" }, dataType)).toBe(expectedCopy(dataType, type));
    },
  );

  it.each([
    // Conversions allowed: to string, to the same type, integer → decimal, date → dateTime.
    ["integer", "decimal", "decimal", "ok"],
    ["date", "dateTime", "dateTime", "TYPE_MISMATCH"], // on effectiveDateTime, a choice (#156)
    ["date", "date", "date", "ok"],
    ["integer", "string", "string", "ok"],
    ["decimal", "string", "string", "ok"],
    ["boolean", "string", "string", "ok"],
    ["date", "string", "string", "ok"],
    ["dateTime", "string", "string", "ok"],
    ["categorical", "string", "string", "ok"],
    ["integer", "string", "uri", "TYPE_PRECISION"],
    // The output of a conversion is checked like a copy of that type.
    ["date", "dateTime", "date", "TYPE_MISMATCH"],
    // Conversions the table does not have.
    ["string", "integer", "integer", "TYPE_MISMATCH"],
    ["decimal", "integer", "integer", "TYPE_MISMATCH"],
    ["dateTime", "date", "date", "TYPE_MISMATCH"],
    ["string", "boolean", "boolean", "TYPE_MISMATCH"],
  ] as const)("cast: %s → %s on %s is %s", (dataType, to, type, expected) => {
    expect(outcome(type, { kind: "cast", to }, dataType)).toBe(expected);
  });

  it.each(
    (["code", "Coding", "CodeableConcept", "boolean"] as const).flatMap((target) =>
      ["code", "Coding", "CodeableConcept", "boolean", "string", "Quantity"].map(
        (type) => [target, type] as const,
      ),
    ),
  )("value map to %s on %s", (target, type) => {
    expect(
      outcome(type, { kind: "valueMap", valueMapId: "vm" }, "categorical", valueMap(target)),
    ).toBe(target === type ? "ok" : "TYPE_MISMATCH");
  });

  it.each(
    (["integer", "decimal", "string"] as const).flatMap((dataType) =>
      [...QUANTITIES, "decimal", "CodeableConcept"].map((type) => [dataType, type] as const),
    ),
  )("quantity: %s column on %s", (dataType, type) => {
    const fits =
      QUANTITIES.includes(type) && dataType !== "string" && !DERIVED_QUANTITIES.has(type);
    expect(outcome(type, { kind: "quantity" }, dataType)).toBe(fits ? "ok" : "TYPE_MISMATCH");
  });

  // Coding from a code column (#106): the type written must be the element's; the column holds
  // the code (string, categorical or integer).
  it.each([
    ["CodeableConcept", "CodeableConcept", "categorical", "ok"],
    ["CodeableConcept", "CodeableConcept", "integer", "ok"],
    ["Coding", "Coding", "string", "ok"],
    ["Coding", "CodeableConcept", "string", "TYPE_MISMATCH"],
    ["CodeableConcept", "Coding", "string", "TYPE_MISMATCH"],
    ["CodeableConcept", "string", "string", "TYPE_MISMATCH"],
    ["CodeableConcept", "CodeableConcept", "decimal", "TYPE_MISMATCH"],
    ["CodeableConcept", "CodeableConcept", "date", "TYPE_MISMATCH"],
  ] as const)("coding as %s on %s from a %s column is %s", (as, type, dataType, expected) => {
    expect(outcome(type, { kind: "coding", system: "http://example.org/cs", as }, dataType)).toBe(
      expected,
    );
  });

  it.each(["string", "markdown", "code", "integer", "CodeableConcept"])("concat on %s", (type) => {
    expect(outcome(type, { kind: "concat", columnIds: ["col", "col"] })).toBe(
      type === "string" || type === "markdown" ? "ok" : "TYPE_MISMATCH",
    );
  });

  const constants: FhirValue[] = [
    { type: "string", value: "x" },
    { type: "code", value: "x" },
    { type: "boolean", value: true },
    { type: "integer", value: 1 },
    { type: "decimal", value: 1.5 },
    { type: "date", value: "2026-01-01" },
    { type: "dateTime", value: "2026-01-01T10:00:00+01:00" },
    { type: "uri", value: "http://example.org" },
    { type: "Coding", coding: { system: "http://example.org", code: "x" } },
    { type: "CodeableConcept", coding: { system: "http://example.org", code: "x" } },
    { type: "Quantity", value: 1, unit: { system: "http://unitsofmeasure.org", code: "mg" } },
  ];
  it.each(
    constants.flatMap((value) =>
      [
        "string",
        "code",
        "boolean",
        "integer",
        "decimal",
        "date",
        "dateTime",
        "uri",
        "Coding",
        "CodeableConcept",
        ...QUANTITIES,
      ].map((type) => [value.type, type, value] as const),
    ),
  )("constant %s on %s", (valueType, type, value) => {
    const allowed = valueType === type || (valueType === "Quantity" && QUANTITIES.includes(type));
    // The literal's type: quoted for string, code, uri, date and dateTime; Quantity cannot be written.
    const literal = ["string", "code", "uri", "date", "dateTime"].includes(valueType)
      ? "string"
      : valueType;
    const fits = allowed && valueType !== "Quantity" && engine("ok", type, literal) === "ok";
    expect(outcome(type, { kind: "constant", value })).toBe(fits ? "ok" : "TYPE_MISMATCH");
  });

  it.each(["Reference", "CodeableConcept", "string"])("reference on %s", (type) => {
    expect(outcome(type, { kind: "reference", targetInstanceId: "ins" })).toBe(
      type === "Reference" ? "ok" : "TYPE_MISMATCH",
    );
  });

  it("an expert expression is never type-checked, only flagged", () => {
    expect(outcome("HumanName", { kind: "expression", language: "fml", expression: "x" })).toBe(
      "EXPRESSION_NOT_TYPE_CHECKED" as Outcome,
    );
  });
});
