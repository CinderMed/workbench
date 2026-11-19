import type { Column, Condition, Instance, MappingRow, ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { CardinalityCode, checkCardinality, exclusive, requirements } from "./cardinality.js";
import { FhirDefinitions } from "./definitions.js";
import { r4Paths } from "./test-support/synthetic-packages.js";

const defs = (() => {
  const index = buildIndex("4.0.1", [r4Paths()]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  for (const [file, text] of index.value.files) opened.value.add(file, text);
  return opened.value;
})();

const columns: [Column, ...Column[]] = [
  { id: "a", name: "a", dataType: "string" },
  { id: "b", name: "b", dataType: "string" },
  {
    id: "k",
    name: "kind",
    dataType: "categorical",
    allowedValues: [{ code: "1" }, { code: "2" }, { code: "3" }],
  },
  { id: "m", name: "sites", dataType: "multipleChoice", allowedValues: [{ code: "x" }] },
];
const obs = (extra: Partial<Instance> = {}): Instance => ({
  id: "obs",
  resourceType: "Observation",
  index: 0,
  sourceId: "src",
  multiplicity: { kind: "perRow" },
  ...extra,
});
let n = 0;
function row(
  path: string,
  columnId: string | undefined,
  extra: Partial<MappingRow> = {},
): MappingRow {
  n += 1;
  return {
    id: `map_${String(n)}`,
    code: `R-${String(n).padStart(3, "0")}`,
    instanceId: "obs",
    path,
    transform: { kind: "copy" },
    ...(columnId === undefined ? {} : { columnId }),
    ...extra,
  };
}
function check(mappings: MappingRow[], instance = obs()) {
  const project: ProjectFile = {
    formatVersion: "1.3.0",
    project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
    sources: [{ id: "src", name: "T", columns }],
    instances: [instance],
    mappings,
    valueMaps: [],
  };
  return checkCardinality(project, defs, (i) => i.resourceType).map((r) => [
    r.severity,
    r.code,
    r.id,
    r.field,
  ]);
}
const equals = (columnId: string, value: string): Condition => ({ op: "equals", columnId, value });

describe("CARDINALITY_MISMATCH", () => {
  it("needs repeat eachValue for a multiple-choice column", () => {
    const valueMap = { transform: { kind: "valueMap" as const, valueMapId: "vm" } };
    const without = row("component[a].code", "m", valueMap);
    expect(check([without])).toEqual([
      ["error", CardinalityCode.CARDINALITY_MISMATCH, without.id, "repeat"],
    ]);
    expect(
      check([row("component[a].code", "m", { ...valueMap, repeat: { kind: "eachValue" } })]),
    ).toEqual([]);
    expect(check([row("code", "k", valueMap)])).toEqual([]);
  });
});

describe("DUPLICATE_TARGET", () => {
  it("warns about two writes to one single-valued element, on the later one", () => {
    const first = row("valueString", "a");
    const second = row("valueString", "b");
    expect(check([first, second])).toEqual([
      ["warning", CardinalityCode.DUPLICATE_TARGET, second.id, "path"],
    ]);
  });

  it("treats a choice under two names as one element", () => {
    const second = row("valueBoolean", "b");
    expect(check([row("valueString", "a"), second])).toEqual([
      ["warning", CardinalityCode.DUPLICATE_TARGET, second.id, "path"],
    ]);
  });

  it("recognises conditions on the same column with different values", () => {
    expect(
      check([
        row("valueString", "a", { condition: equals("k", "1") }),
        row("valueString", "b", { condition: equals("k", "2") }),
      ]),
    ).toEqual([]);
    expect(
      check([
        row("valueString", "a", { condition: { op: "in", columnId: "k", values: ["1", "2"] } }),
        row("valueString", "b", { condition: equals("k", "3") }),
      ]),
    ).toEqual([]);
    const overlap = row("valueString", "b", {
      condition: { op: "in", columnId: "k", values: ["2", "3"] },
    });
    expect(
      check([
        row("valueString", "a", { condition: { op: "in", columnId: "k", values: ["1", "2"] } }),
        overlap,
      ]),
    ).toEqual([["warning", CardinalityCode.DUPLICATE_TARGET, overlap.id, "path"]]);
  });

  it("recognises a row that needs a column empty against a row that reads it", () => {
    const emptyA: Condition = { op: "empty", columnId: "a" };
    expect(
      check([row("valueString", "a"), row("valueString", "b", { condition: emptyA })]),
    ).toEqual([]);
    expect(
      check([
        row("valueString", "a"),
        row("valueString", "b", {
          condition: { op: "and", conditions: [emptyA, { op: "notEmpty", columnId: "b" }] },
        }),
      ]),
    ).toEqual([]);
    // or, not, notEquals: not analysed, so not recognised.
    const unknown = row("valueString", "b", {
      condition: { op: "not", condition: { op: "notEmpty", columnId: "a" } },
    });
    expect(check([row("valueString", "a"), unknown])).toEqual([
      ["warning", CardinalityCode.DUPLICATE_TARGET, unknown.id, "path"],
    ]);
  });

  it("counts fixed values as always written", () => {
    const written = row("status", "a");
    expect(
      check(
        [written],
        obs({ fixedValues: [{ path: "status", value: { type: "code", value: "final" } }] }),
      ),
    ).toEqual([["warning", CardinalityCode.DUPLICATE_TARGET, written.id, "path"]]);
  });

  it("allows several writes to repeating elements, and to different slices", () => {
    expect(check([row("component[a].code.text", "a"), row("component[b].code.text", "b")])).toEqual(
      [],
    );
    const second = row("component[a].code.text", "b");
    expect(check([row("component[a].code.text", "a"), second])).toEqual([
      ["warning", CardinalityCode.DUPLICATE_TARGET, second.id, "path"],
    ]);
    expect(check([row("code.coding.code", "a"), row("code.coding.code", "b")]).length).toBe(1);
    expect(check([row("nothing", "a"), row("nothing", "b")])).toEqual([]);
  });

  it("leaves roles of unknown types alone", () => {
    const project: ProjectFile = {
      formatVersion: "1.3.0",
      project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
      sources: [{ id: "src", name: "T", columns }],
      instances: [obs()],
      mappings: [row("valueString", "a"), row("valueString", "b")],
      valueMaps: [],
    };
    expect(checkCardinality(project, defs, () => undefined)).toEqual([]);
  });
});

describe("requirements", () => {
  it("narrows value lists and keeps an empty requirement", () => {
    const needs = requirements("k", {
      op: "and",
      conditions: [
        { op: "in", columnId: "k", values: ["1", "2"] },
        { op: "in", columnId: "k", values: ["2", "3"] },
        { op: "empty", columnId: "a" },
        { op: "notEmpty", columnId: "a" },
      ],
    });
    expect(needs.get("k")).toEqual({ empty: false, values: new Set(["2"]) });
    expect(needs.get("a")).toEqual({ empty: true });
    expect(exclusive(needs, requirements(undefined, equals("k", "1")))).toBe(true);
    expect(exclusive(needs, requirements(undefined, equals("k", "2")))).toBe(false);
  });
});
