import type { Instance, MappingRow, ProjectFile, ValueMap } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { BindingCode, checkBinding } from "./binding.js";
import { MAX_VALUE_SET_CODES, buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { resolvePath } from "./element-tree.js";
import { sd } from "./test-support/synthetic-packages.js";
import { loadProjectDefinitions, validateFhir } from "./validate-fhir.js";

const VS = "http://example.org/ValueSet/";
const CS = "http://example.org/CodeSystem/";
const valueSet = (id: string, compose: unknown, extra: Record<string, unknown> = {}) => ({
  resourceType: "ValueSet",
  id,
  url: `${VS}${id}`,
  ...(compose === undefined ? {} : { compose }),
  ...extra,
});
const codeSystem = (id: string, concept: unknown[], content = "complete") => ({
  resourceType: "CodeSystem",
  id,
  url: `${CS}${id}`,
  content,
  concept,
});
const bound = (strength: string, id: string, ...types: string[]) => ({
  binding: { strength, valueSet: `${VS}${id}|1.0` },
  type: types.map((code) => ({ code })),
});

/** One resource with an element bound to each kind of ValueSet the expansion handles. */
function pkg() {
  const many = Array.from({ length: MAX_VALUE_SET_CODES + 1 }, (_, i) => ({
    code: `c${String(i)}`,
  }));
  return {
    id: "hl7.fhir.r4.core",
    version: "4.0.1",
    fhirVersions: ["4.0.1"],
    resources: [
      ...["string", "code"].map((p) => sd(p, "primitive-type", { [p]: {} })),
      sd("Coding", "complex-type", { Coding: {}, "Coding.code": { type: [{ code: "code" }] } }),
      sd("CodeableConcept", "complex-type", {
        CodeableConcept: {},
        "CodeableConcept.coding": { max: "*", type: [{ code: "Coding" }] },
      }),
      sd("Thing", "resource", {
        Thing: {},
        "Thing.listed": bound("required", "listed", "code"),
        "Thing.whole": bound("required", "whole", "Coding"),
        "Thing.nested": bound("extensible", "nested", "CodeableConcept"),
        "Thing.excluded": bound("required", "excluded", "code"),
        "Thing.stored": bound("preferred", "stored", "code"),
        "Thing.filtered": bound("required", "filtered", "code"),
        "Thing.filteredPreferred": bound("preferred", "filtered", "code"),
        "Thing.missing": bound("required", "missing", "code"),
        "Thing.fragment": bound("required", "fragment", "code"),
        "Thing.huge": bound("required", "huge", "code"),
        "Thing.cycle": bound("required", "cycle", "code"),
        "Thing.bare": bound("required", "bare", "code"),
        "Thing.example": bound("example", "listed", "code"),
        "Thing.text": bound("required", "listed", "string"),
        "Thing.unbound": { type: [{ code: "code" }] },
      }),
      valueSet("listed", {
        include: [{ system: `${CS}a`, concept: [{ code: "x" }, { code: "y" }] }],
      }),
      valueSet("whole", { include: [{ system: `${CS}tree` }] }),
      valueSet("nested", {
        include: [{ valueSet: [`${VS}listed`] }, { system: `${CS}b`, concept: [{ code: "z" }] }],
      }),
      valueSet("excluded", {
        include: [{ system: `${CS}tree` }],
        exclude: [{ system: `${CS}tree`, concept: [{ code: "child" }] }],
      }),
      valueSet("stored", undefined, {
        expansion: {
          contains: [
            { system: `${CS}s`, code: "s1", contains: [{ system: `${CS}s`, code: "s2" }] },
          ],
        },
      }),
      valueSet("filtered", {
        include: [
          { system: `${CS}tree`, filter: [{ property: "concept", op: "is-a", value: "root" }] },
        ],
      }),
      valueSet("missing", { include: [{ system: `${CS}nowhere` }] }),
      valueSet("fragment", { include: [{ system: `${CS}frag` }] }),
      valueSet("huge", { include: [{ system: `${CS}huge` }] }),
      valueSet("cycle", { include: [{ valueSet: [`${VS}cycle`] }] }),
      valueSet("bare", undefined),
      codeSystem("tree", [{ code: "root", concept: [{ code: "child" }, { code: "other" }] }]),
      codeSystem("frag", [{ code: "f" }], "fragment"),
      codeSystem("huge", many),
    ],
  };
}

function definitions(loaded = true) {
  const index = buildIndex("4.0.1", [pkg()]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  if (loaded) for (const [file, text] of index.value.files) opened.value.add(file, text);
  return { defs: opened.value, index: index.value };
}

describe("ValueSet expansions in the index", () => {
  it("expands what the packages hold, and says why the rest cannot be", () => {
    const { index } = definitions();
    const entries = Object.fromEntries(
      (index.manifest.valueSets ?? []).map((e) => [e.url.replace(VS, ""), e]),
    );
    expect(Object.keys(entries)).toEqual([
      "bare",
      "cycle",
      "excluded",
      "filtered",
      "fragment",
      "huge",
      "listed",
      "missing",
      "nested",
      "stored",
      "whole",
    ]);
    const reason = (id: string) => {
      const e = entries[id];
      return e?.expandable === false ? e.reason : undefined;
    };
    expect(reason("filtered")).toBe("it uses a filter");
    expect(reason("missing")).toBe(`the code system ${CS}nowhere is not in the packages`);
    expect(reason("fragment")).toBe(
      `the code system ${CS}frag is not complete in the packages (fragment)`,
    );
    expect(reason("huge")).toBe(
      `it has ${String(MAX_VALUE_SET_CODES + 1)} codes, more than the ${String(MAX_VALUE_SET_CODES)} kept offline`,
    );
    expect(reason("cycle")).toBe(
      `it includes ${VS}cycle, which cannot be expanded: the ValueSet includes itself`,
    );
    expect(reason("bare")).toBe("the ValueSet has no compose and no expansion");
    const doc = (id: string) => {
      const e = entries[id];
      return e?.expandable === true
        ? (JSON.parse(index.files.get(e.file) ?? "{}") as { codes: unknown }).codes
        : undefined;
    };
    expect(doc("listed")).toEqual({ [`${CS}a`]: ["x", "y"] });
    expect(doc("whole")).toEqual({ [`${CS}tree`]: ["child", "other", "root"] });
    expect(doc("nested")).toEqual({ [`${CS}a`]: ["x", "y"], [`${CS}b`]: ["z"] });
    expect(doc("excluded")).toEqual({ [`${CS}tree`]: ["other", "root"] });
    expect(doc("stored")).toEqual({ [`${CS}s`]: ["s1", "s2"] });
    expect(entries["listed"]).toMatchObject({
      expandable: true,
      file: "valueSets/hl7.fhir.r4.core/listed.json",
      count: 2,
    });
  });

  it("loads ValueSet documents on demand, checked against the manifest", async () => {
    const { defs, index } = definitions(false);
    expect(defs.valueSetEntry(`${VS}listed|1.0`)?.expandable).toBe(true);
    expect(defs.valueSet(`${VS}listed`)).toBeUndefined();
    const asked: string[] = [];
    const result = await defs.load([`${VS}listed`, `${VS}filtered`], (file) => {
      asked.push(file);
      return Promise.resolve(index.files.get(file) ?? "");
    });
    expect(result.ok).toBe(true);
    expect(asked).toEqual(["valueSets/hl7.fhir.r4.core/listed.json"]);
    expect(defs.valueSet(`${VS}listed`)?.codes).toEqual({ [`${CS}a`]: ["x", "y"] });
    expect(defs.add("valueSets/hl7.fhir.r4.core/whole.json", "{}").issues[0]?.code).toBe(
      "INDEX_DOCUMENT_DIGEST_MISMATCH",
    );
  });
});

describe("checkBinding", () => {
  const { defs } = definitions();
  const element = (path: string) => {
    const r = resolvePath(defs, "Thing", path);
    if (!r.ok) throw new Error(r.issue.message);
    return r.value;
  };
  const check = (path: string, codes: { system?: string; code: string }[]) =>
    checkBinding(
      defs,
      element(path),
      codes.map((c) => ({ ...c, from: "the value" })),
      "R-001: Thing." + path,
    ).map((f) => [f.severity, f.message]);

  it("accepts codes in the ValueSet, by code for code elements and by system and code otherwise", () => {
    expect(check("listed", [{ code: "x" }, { system: "http://elsewhere", code: "y" }])).toEqual([]);
    expect(check("whole", [{ system: `${CS}tree`, code: "child" }])).toEqual([]);
    expect(check("whole", [{ system: `${CS}a`, code: "child" }])).toEqual([
      [
        "error",
        `R-001: Thing.whole: ${CS}a|child (the value) is not in the required ValueSet ${VS}whole`,
      ],
    ]);
  });

  it("is an error for required bindings and a warning for extensible and preferred ones", () => {
    expect(check("listed", [{ code: "q" }])).toEqual([
      ["error", `R-001: Thing.listed: "q" (the value) is not in the required ValueSet ${VS}listed`],
    ]);
    expect(check("nested", [{ system: `${CS}b`, code: "q" }])[0]?.[0]).toBe("warning");
    expect(check("stored", [{ code: "q" }])[0]?.[0]).toBe("warning");
  });

  it("warns that a required binding cannot be checked, and is silent for the others", () => {
    expect(check("filtered", [{ code: "q" }])).toEqual([
      [
        "warning",
        `R-001: Thing.filtered: binding not checked: the required ValueSet ${VS}filtered cannot be expanded offline (it uses a filter)`,
      ],
    ]);
    expect(check("filteredPreferred", [{ code: "q" }])).toEqual([]);
    expect(check("listed", [])).toEqual([]);
  });

  it("checks only coded elements with a checked binding", () => {
    expect(check("example", [{ code: "q" }])).toEqual([]);
    expect(check("text", [{ code: "q" }])).toEqual([]);
    expect(check("unbound", [{ code: "q" }])).toEqual([]);
  });

  it("says so when the ValueSet document is not loaded, or not in the index", () => {
    const empty = definitions(false).defs;
    const r = resolvePath(empty, "Thing", "listed");
    expect(r.ok).toBe(false); // nothing loaded at all
    const partial = definitions(false);
    for (const [file, text] of partial.index.files)
      if (file.startsWith("types/")) partial.defs.add(file, text);
    const listed = resolvePath(partial.defs, "Thing", "listed");
    if (!listed.ok) throw new Error("not resolved");
    expect(
      checkBinding(partial.defs, listed.value, [{ code: "x", from: "the value" }], "here"),
    ).toEqual([
      {
        severity: "warning",
        message: `here: binding not checked: the ValueSet ${VS}listed is not loaded`,
      },
    ]);
    const unknown = {
      ...listed.value,
      binding: { strength: "required" as const, valueSet: `${VS}nothing` },
    };
    expect(
      checkBinding(defs, unknown, [{ code: "x", from: "the value" }], "here")[0]?.message,
    ).toBe(
      `here: binding not checked: the required ValueSet ${VS}nothing cannot be expanded offline (it is not in the definitions)`,
    );
  });
});

describe("validateFhir, bindings", () => {
  const { defs, index } = definitions();
  const thing: Instance = {
    id: "ins",
    resourceType: "Thing",
    index: 0,
    sourceId: "src",
    multiplicity: { kind: "perRow" },
    fixedValues: [{ path: "listed", value: { type: "code", value: "nope" } }],
  };
  const map: ValueMap = {
    id: "vm",
    name: "codes",
    target: "code",
    entries: [
      { sourceValue: "1", target: { value: "x" }, action: { kind: "use" } },
      { sourceValue: "2", target: { value: "bad" }, action: { kind: "use" } },
      {
        sourceValue: "3",
        action: {
          kind: "setElement",
          set: [{ path: "listed", value: { type: "code", value: "worse" } }],
        },
      },
    ],
  };
  const row = (
    id: string,
    path: string,
    transform: MappingRow["transform"],
    columnId?: string,
  ): MappingRow => ({
    id,
    code: `R-${id}`,
    instanceId: "ins",
    path,
    transform,
    ...(columnId === undefined ? {} : { columnId }),
  });
  const p: ProjectFile = {
    formatVersion: "1.3.0",
    project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
    sources: [
      {
        id: "src",
        name: "T",
        columns: [
          {
            id: "cat",
            name: "kind",
            dataType: "categorical",
            allowedValues: [{ code: "x" }, { code: "k" }],
          },
          {
            id: "codes",
            name: "codes",
            dataType: "categorical",
            allowedValues: [{ code: "1" }, { code: "2" }, { code: "3" }],
          },
        ],
      },
    ],
    instances: [thing],
    mappings: [
      row("1", "listed", { kind: "valueMap", valueMapId: "vm" }, "codes"),
      row("2", "listed", { kind: "constant", value: { type: "code", value: "y" } }),
      row("3", "listed", { kind: "copy" }, "cat"),
      row("4", "listed", { kind: "constant", value: { type: "code", value: "z" } }),
    ],
    valueMaps: [map],
  };
  const bindings = (defsToUse: FhirDefinitions) =>
    validateFhir(p, defsToUse)
      .filter((r) => r.code === BindingCode.BINDING_VIOLATION)
      .map((r) => [r.objectKind, r.id, r.field]);

  it("puts each finding on the object that holds the code", () => {
    expect(bindings(defs)).toEqual([
      ["instance", "ins", "fixedValues.0.value"],
      ["valueMap", "vm", "entries.1.target"],
      ["valueMap", "vm", "entries.2.action.set.0.value"],
      ["mapping", "3", "columnId"],
      ["mapping", "4", "transform.value"],
    ]);
  });

  it("loads the ValueSets a project needs, so the browser gets the same findings", async () => {
    const opened = FhirDefinitions.open(index.manifest);
    if (!opened.ok) throw new Error("not opened");
    const browser = opened.value;
    await loadProjectDefinitions(p, browser, (file) =>
      Promise.resolve(index.files.get(file) ?? ""),
    );
    expect(bindings(browser)).toEqual(bindings(defs));
    expect(browser.valueSet(`${VS}listed`)).toBeDefined();
  });
});
