import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { elementTree, referenceTargets, resolvePath, withDefinitions } from "./element-tree.js";
import { FHIR, r4Paths } from "./test-support/synthetic-packages.js";

function built() {
  const result = buildIndex("4.0.1", [r4Paths()]);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Definitions with every document loaded (as in the CLI), or none (as in the browser). */
function definitions(loaded = true) {
  const index = built();
  const opened = FhirDefinitions.open(index.manifest);
  if (!opened.ok) throw new Error("not opened");
  if (loaded) for (const [file, text] of index.files) opened.value.add(file, text);
  return { defs: opened.value, files: index.files };
}

const { defs } = definitions();
const resolved = (ref: string, path: string) => {
  const result = resolvePath(defs, ref, path);
  if (!result.ok) throw new Error(result.issue.message);
  return result.value;
};
const failed = (ref: string, path: string) => {
  const result = resolvePath(defs, ref, path);
  if (result.ok) throw new Error(`${path} resolved`);
  return result.issue;
};

describe("resolvePath", () => {
  it("resolves the root and inline elements", () => {
    expect(resolved("Observation", "")).toMatchObject({ elementId: "Observation", segments: [] });
    expect(resolved("Observation", "status")).toEqual({
      path: "status",
      elementId: "Observation.status",
      definition: `${FHIR}Observation`,
      min: 1,
      max: "1",
      types: [{ code: "code" }],
      binding: {
        strength: "required",
        valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
      },
      isModifier: true,
      segments: [
        {
          name: "status",
          elementId: "Observation.status",
          definition: `${FHIR}Observation`,
          min: 1,
          max: "1",
        },
      ],
    });
  });

  it("goes into datatypes and choices", () => {
    const code = resolved("Observation", "code.coding.code");
    expect(code.types).toEqual([{ code: "code" }]);
    expect(code.segments.map((s) => [s.elementId, s.max])).toEqual([
      ["Observation.code", "1"],
      ["CodeableConcept.coding", "*"],
      ["Coding.code", "1"],
    ]);
    const value = resolved("Observation", "valueQuantity.value");
    expect(value.segments[0]).toMatchObject({
      name: "valueQuantity",
      elementId: "Observation.value[x]",
    });
    expect(resolved("Observation", "valueQuantity")).toMatchObject({
      choice: { element: "value[x]", type: "Quantity" },
      types: [{ code: "Quantity" }],
      short: "Actual result",
    });
    expect(resolved("Observation", "valueBoolean").types).toEqual([{ code: "boolean" }]);
    expect(resolved("Observation", "component[nrs].valueInteger").segments).toEqual([
      {
        name: "component",
        slice: "nrs",
        elementId: "Observation.component",
        definition: `${FHIR}Observation`,
        min: 0,
        max: "*",
      },
      {
        name: "valueInteger",
        elementId: "Observation.component.value[x]",
        definition: `${FHIR}Observation`,
        min: 0,
        max: "1",
      },
    ]);
  });

  it("follows contentReference in its R4 and R5 forms", () => {
    expect(resolved("Questionnaire", "item.item.item.linkId").types).toEqual([{ code: "string" }]);
    expect(resolved("Questionnaire", "item.answer.linkId").elementId).toBe(
      "Questionnaire.item.linkId",
    );
  });

  it("uses profile slices, type slices and fixed constraints", () => {
    const vitals = `${FHIR}vitalsigns`;
    expect(resolved(vitals, "category[VSCat].coding.code")).toMatchObject({
      elementId: "Coding.code",
    });
    expect(resolved(vitals, "category[VSCat]")).toMatchObject({ sliceName: "VSCat", min: 1 });
    expect(resolved(vitals, "category[mine]")).not.toHaveProperty("sliceName");
    expect(resolved(vitals, "valueQuantity")).toMatchObject({
      elementId: "Observation.value[x]:valueQuantity",
      min: 1,
    });
    expect(resolved(vitals, "valueString").elementId).toBe("Observation.value[x]");
  });

  it.each([
    ["Observation", "nothing", "PATH_NOT_FOUND", 0, "nothing is not an element of Observation"],
    [
      "Observation",
      "status.value",
      "PATH_NOT_FOUND",
      1,
      "value is not an element of Observation.status",
    ],
    ["Observation", "code..text", "PATH_NOT_FOUND", 1, '"" is not a valid path segment'],
    [
      "Observation",
      "value",
      "CHOICE_TYPE_REQUIRED",
      0,
      "value is a choice: use one of valueQuantity, valueString, valueBoolean",
    ],
    [
      "Observation",
      "valueQuantity.extension",
      "EXTENSION_NOT_SUPPORTED",
      1,
      "extension: extensions cannot be mapped",
    ],
    [
      "Observation",
      "code[x1]",
      "SLICE_NOT_REPEATING",
      0,
      "code[x1]: code does not repeat (max 1), so it cannot have named slices",
    ],
    [
      `${FHIR}vitalsigns`,
      "method",
      "PATH_PROHIBITED",
      0,
      `method is prohibited by ${FHIR}vitalsigns`,
    ],
    [
      `${FHIR}vitalsigns`,
      "category[gone]",
      "PATH_PROHIBITED",
      0,
      `category[gone] is prohibited by ${FHIR}vitalsigns`,
    ],
    [
      `${FHIR}SimpleQuantity`,
      "comparator",
      "PATH_PROHIBITED",
      0,
      `comparator is prohibited by ${FHIR}SimpleQuantity`,
    ],
  ])("%s %s → %s", (ref, path, code, segment, message) => {
    expect(failed(ref, path)).toEqual({ code, message, path, segment });
  });

  it("names the definition it needs", () => {
    expect(failed("Nothing", "a")).toEqual({
      code: "DEFINITION_UNKNOWN",
      message: "Nothing is not in the definitions",
      path: "a",
      type: "Nothing",
    });
    const empty = definitions(false).defs;
    const missing = resolvePath(empty, "Observation", "code");
    expect(missing.ok ? undefined : missing.issue).toMatchObject({
      code: "TYPE_NOT_LOADED",
      type: "Observation",
    });
  });
});

describe("elementTree", () => {
  it("gives one level, choices by type, without extensions or prohibited elements", () => {
    const tree = elementTree(defs, "Observation");
    expect(tree.ok && tree.value.map((n) => [n.path, n.expandable])).toEqual([
      ["code", true],
      ["subject", true],
      ["focus", true],
      ["valueQuantity", true],
      ["valueString", false],
      ["valueBoolean", false],
      ["component", true],
      ["status", false],
    ]);
    const value = tree.ok ? tree.value.find((n) => n.name === "valueQuantity") : undefined;
    expect(value).toMatchObject({
      choice: { element: "value[x]", type: "Quantity" },
      types: [{ code: "Quantity" }],
    });
    expect(tree.ok && tree.value.find((n) => n.name === "status")).toMatchObject({
      isModifier: true,
      binding: { strength: "required" },
    });
  });

  it("expands datatypes, backbone elements and contentReference on request", () => {
    const quantity = elementTree(defs, "Observation", "valueQuantity");
    expect(quantity.ok && quantity.value.map((n) => n.path)).toEqual([
      "valueQuantity.value",
      "valueQuantity.comparator",
      "valueQuantity.unit",
    ]);
    const component = elementTree(defs, "Observation", "component[a]");
    expect(component.ok && component.value.map((n) => n.path)).toEqual([
      "component[a].code",
      "component[a].valueQuantity",
      "component[a].valueInteger",
    ]);
    const nested = elementTree(defs, "Questionnaire", "item.item");
    expect(nested.ok && nested.value.map((n) => n.name)).toEqual(["linkId", "item", "answer"]);
    const leaf = elementTree(defs, "Observation", "status");
    expect(leaf.ok && leaf.value).toEqual([]);
  });

  it("lists profile slices after the element they slice", () => {
    const tree = elementTree(defs, `${FHIR}vitalsigns`);
    expect(tree.ok && tree.value.map((n) => n.path)).toEqual([
      "category",
      "category[VSCat]",
      "valueQuantity",
      "valueString",
    ]);
    expect(tree.ok && tree.value[1]).toMatchObject({
      sliceName: "VSCat",
      min: 1,
      mustSupport: true,
      expandable: true,
    });
    const slice = elementTree(defs, `${FHIR}vitalsigns`, "category[VSCat]");
    expect(slice.ok && slice.value.map((n) => n.elementId)).toEqual([
      "Observation.category:VSCat.coding",
    ]);
  });

  it("reports what the path reports", () => {
    const tree = elementTree(defs, "Observation", "nothing");
    expect(tree.ok ? undefined : tree.issue.code).toBe("PATH_NOT_FOUND");
    const empty = definitions(false).defs;
    const missing = elementTree(empty, "Observation");
    expect(missing.ok ? undefined : missing.issue.code).toBe("TYPE_NOT_LOADED");
  });
});

describe("referenceTargets", () => {
  it("lists resource types and profiles, or any", () => {
    expect(referenceTargets(defs, "Observation", "subject")).toEqual({
      ok: true,
      value: {
        any: false,
        resourceTypes: ["Group", "Observation", "Patient"],
        profiles: [`${FHIR}vitalsigns`],
        // A datatype profile and a profile of a package that is not loaded are not resource targets.
        unknown: [`${FHIR}SimpleQuantity`, "http://example.org/StructureDefinition/not-loaded"],
      },
    });
    expect(referenceTargets(defs, "Observation", "focus")).toEqual({
      ok: true,
      value: {
        any: true,
        resourceTypes: ["Group", "Observation", "Patient", "Questionnaire"],
        profiles: [],
        unknown: [],
      },
    });
    const code = referenceTargets(defs, "Observation", "code");
    expect(code.ok ? undefined : code.issue).toEqual({
      code: "NOT_A_REFERENCE",
      message: "code is not a Reference",
      path: "code",
    });
    const bad = referenceTargets(defs, "Observation", "nothing");
    expect(bad.ok ? undefined : bad.issue.code).toBe("PATH_NOT_FOUND");
  });
});

describe("withDefinitions", () => {
  it("loads the documents a question needs, one at a time, and only those", async () => {
    const { defs: empty, files } = definitions(false);
    const asked: string[] = [];
    const fetch = (file: string) => {
      asked.push(file);
      return Promise.resolve(files.get(file) ?? "");
    };
    const result = await withDefinitions(empty, fetch, () =>
      resolvePath(empty, "Observation", "code.coding.system"),
    );
    expect(result.ok && result.value.types).toEqual([{ code: "uri" }]);
    expect(asked).toEqual([
      "types/Observation.json",
      "types/CodeableConcept.json",
      "types/Coding.json",
    ]);
  });

  it("stops when a document cannot be loaded, and returns other answers as they are", async () => {
    const { defs: empty } = definitions(false);
    const result = await withDefinitions(
      empty,
      () => Promise.reject(new Error("offline")),
      () => resolvePath(empty, "Observation", "code"),
    );
    expect(result.ok ? undefined : result.issue).toMatchObject({
      code: "TYPE_NOT_LOADED",
      message: "types/Observation.json could not be fetched: offline",
    });
    const notFound = await withDefinitions(
      empty,
      () => Promise.resolve(""),
      () => resolvePath(defs, "Observation", "nothing"),
    );
    expect(notFound.ok ? undefined : notFound.issue.code).toBe("PATH_NOT_FOUND");
  });

  it("does not loop on a document that loads but does not help", async () => {
    let calls = 0;
    const { defs: empty, files } = definitions(false);
    const result = await withDefinitions(
      empty,
      (file) => Promise.resolve(files.get(file) ?? ""),
      () => {
        calls++;
        return {
          ok: false,
          issue: { code: "TYPE_NOT_LOADED", message: "always", path: "", type: "Patient" },
        };
      },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
  });
});
