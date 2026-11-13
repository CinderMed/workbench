// The compact definition index (ADR-0013) built from the real core packages, hl7.fhir.r4.core
// 4.0.1 and hl7.fhir.r5.core 5.0.0, read from the FHIR package cache (~/.fhir/packages) or
// downloaded and checked against their pinned SHA-256. Runs when FHIR_CORE_PACKAGES=1 (the Unit
// tests job in CI, with the package cache cached).
import {
  FhirDefinitions,
  elementTree,
  referenceTargets,
  resolvePath,
  withDefinitions,
} from "../packages/fhir-defs/dist/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const SD = "http://hl7.org/fhir/StructureDefinition/";

/**
 * Size budget of one type document. The browser loads documents one type at a time, so no single
 * document may be large; the largest core one is ExplanationOfBenefit (47 kB in R4, 58 kB in R5).
 */
const MAX_DOCUMENT_BYTES = 64 * 1024;

describe.runIf(enabled).each([
  { fhirVersion: "4.0.1", coreId: "hl7.fhir.r4.core", entries: 255, resourceTypes: 146 },
  { fhirVersion: "5.0.0", coreId: "hl7.fhir.r5.core", entries: 295, resourceTypes: 158 },
])("definition index of FHIR $fhirVersion", ({ fhirVersion, coreId, entries, resourceTypes }) => {
  it("is built from the core package, deterministically, with small documents", async () => {
    const first = await loadDefinitions(fhirVersion, []);
    const second = await loadDefinitions(fhirVersion, []);
    const { index, definitions, issues } = first;
    expect(index.manifest.packages).toEqual([{ id: coreId, version: fhirVersion }]);
    expect(second.index.manifestText).toBe(index.manifestText);
    expect([...second.index.files]).toEqual([...index.files]);
    // The only definitions left out with a warning: two example profiles shipped without snapshot.
    expect(issues.map((i) => [i.code, i.subject])).toEqual([
      ["DEFINITION_WITHOUT_SNAPSHOT", `${SD}example-composition`],
      ["DEFINITION_WITHOUT_SNAPSHOT", `${SD}example-section-library`],
    ]);
    expect(index.manifest.entries).toHaveLength(entries);
    for (const entry of index.manifest.entries) {
      expect(definitions.isLoaded(entry.url), entry.url).toBe(true);
      expect(entry.size, entry.file).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    }
  }, 300_000);

  it("answers from the core definitions", async () => {
    const { definitions } = await loadDefinitions(fhirVersion, []);
    const types = definitions.resourceTypes();
    expect(types).toHaveLength(resourceTypes);
    expect(types).toEqual(
      expect.arrayContaining(["Bundle", "Encounter", "Observation", "Patient"]),
    );
    expect(types).not.toContain("DomainResource");
    expect(definitions.entry("Quantity")?.kind).toBe("complex-type");
    expect(definitions.entry(`${SD}SimpleQuantity`)?.derivation).toBe("constraint");

    const patient = definitions.document("Patient");
    expect(patient?.elements.find((e) => e.id === "Patient.name")).toMatchObject({
      max: "*",
      type: [{ code: "HumanName" }],
    });
    expect(patient?.elements.find((e) => e.id === "Patient.gender")?.binding).toEqual({
      strength: "required",
      valueSet: `http://hl7.org/fhir/ValueSet/administrative-gender|${fhirVersion}`,
    });
    const observation = definitions.document("Observation");
    const value = observation?.elements.find((e) => e.id === "Observation.value[x]");
    expect(value?.type?.map((t) => t.code)).toEqual(
      expect.arrayContaining(["Quantity", "CodeableConcept", "string", "boolean", "dateTime"]),
    );
    const subject = observation?.elements.find((e) => e.id === "Observation.subject");
    expect(subject?.type?.[0]?.targetProfile).toContain(`${SD}Patient`);
  }, 300_000);
});

describe.runIf(enabled).each(["4.0.1", "5.0.0"])("element paths in FHIR %s", (fhirVersion) => {
  const r5 = fhirVersion === "5.0.0";
  let defs: FhirDefinitions;
  let files: ReadonlyMap<string, string>;
  let manifest: unknown;
  beforeAll(async () => {
    const loaded = await loadDefinitions(fhirVersion, []);
    defs = loaded.definitions;
    files = loaded.index.files;
    manifest = loaded.index.manifest;
  }, 300_000);

  const resolve = (ref: string, path: string) => {
    const result = resolvePath(defs, ref, path);
    if (!result.ok) throw new Error(`${ref} ${path}: ${result.issue.message}`);
    return result.value;
  };
  const codes = (ref: string, path: string) => resolve(ref, path).types.map((t) => t.code);
  const issue = (ref: string, path: string) => {
    const result = resolvePath(defs, ref, path);
    return result.ok ? undefined : [result.issue.code, result.issue.segment];
  };

  it.each([
    ["Patient", "name.family", ["string"]],
    ["Patient", "name.given", ["string"]],
    ["Patient", "gender", ["code"]],
    ["Patient", "birthDate", ["date"]],
    ["Patient", "identifier.value", ["string"]],
    ["Patient", "identifier.system", ["uri"]],
    ["Observation", "valueQuantity", ["Quantity"]],
    ["Observation", "valueQuantity.value", ["decimal"]],
    ["Observation", "valueQuantity.unit", ["string"]],
    ["Observation", "valueCodeableConcept.coding.code", ["code"]],
    ["Observation", "valueBoolean", ["boolean"]],
    ["Observation", "effectiveDateTime", ["dateTime"]],
    ["Observation", "code.coding.system", ["uri"]],
    ["Observation", "component[nrs].valueInteger", ["integer"]],
    ["Observation", "referenceRange.low.value", ["decimal"]],
    ["Encounter", r5 ? "actualPeriod.start" : "period.start", ["dateTime"]],
    ["Encounter", "class", [r5 ? "CodeableConcept" : "Coding"]],
    ["Questionnaire", "item.item.linkId", ["string"]],
    ["Condition", "onsetDateTime", ["dateTime"]],
  ])("%s.%s is %j", (ref, path, expected) => {
    expect(codes(ref, path)).toEqual(expected);
  });

  it("reports each segment with its cardinality, and choices with their type", () => {
    const family = resolve("Patient", "name.family");
    expect(family.segments).toEqual([
      { name: "name", elementId: "Patient.name", definition: `${SD}Patient`, min: 0, max: "*" },
      {
        name: "family",
        elementId: "HumanName.family",
        definition: `${SD}HumanName`,
        min: 0,
        max: "1",
      },
    ]);
    expect(resolve("Observation", "valueQuantity").choice).toEqual({
      element: "value[x]",
      type: "Quantity",
    });
    expect(resolve("Observation", "component[nrs].valueInteger").segments[0]).toMatchObject({
      name: "component",
      slice: "nrs",
      max: "*",
    });
    expect(resolve("Patient", "gender").binding?.strength).toBe("required");
    expect(resolve("Encounter", "class").max).toBe(r5 ? "*" : "1");
  });

  it.each([
    ["Patient", "foo", "PATH_NOT_FOUND", 0],
    ["Patient", "name.foo", "PATH_NOT_FOUND", 1],
    ["Patient", "name.family.value", "PATH_NOT_FOUND", 2],
    ["Patient", "extension", "EXTENSION_NOT_SUPPORTED", 0],
    ["Patient", "name.extension", "EXTENSION_NOT_SUPPORTED", 1],
    ["Patient", "gender[local]", "SLICE_NOT_REPEATING", 0],
    ["Observation", "value", "CHOICE_TYPE_REQUIRED", 0],
    ["Observation", "valueQuantity.foo", "PATH_NOT_FOUND", 1],
    ["Nothing", "a", "DEFINITION_UNKNOWN", undefined],
    // R5 renamed Encounter.period to actualPeriod: an R4 path is not found in R5.
    ["Encounter", r5 ? "period" : "actualPeriod", "PATH_NOT_FOUND", 0],
    [`${SD}SimpleQuantity`, "comparator", "PATH_PROHIBITED", 0],
  ])("%s.%s is %s", (ref, path, code, segment) => {
    expect(issue(ref, path)).toEqual([code, segment]);
  });

  it("follows profile slices", () => {
    const category = resolve(`${SD}vitalsigns`, "category[VSCat].coding.code");
    expect(category.segments[0]).toMatchObject({
      elementId: "Observation.category:VSCat",
      slice: "VSCat",
    });
    expect(resolve(`${SD}vitalsigns`, "category[VSCat]").sliceName).toBe("VSCat");
    expect(resolve(`${SD}vitalsigns`, "category[local]").sliceName).toBeUndefined();
  });

  it("gives the targets of a Reference", () => {
    const subject = referenceTargets(defs, "Observation", "subject");
    expect(subject.ok && subject.value.resourceTypes).toEqual(
      expect.arrayContaining(["Device", "Group", "Location", "Patient"]),
    );
    const practitioner = referenceTargets(defs, "Patient", "generalPractitioner");
    expect(practitioner.ok && practitioner.value).toEqual({
      any: false,
      resourceTypes: ["Organization", "Practitioner", "PractitionerRole"],
      profiles: [],
      unknown: [],
    });
    const focus = referenceTargets(defs, "Observation", "focus");
    expect(focus.ok && focus.value.any).toBe(true);
    const gender = referenceTargets(defs, "Patient", "gender");
    expect(gender.ok ? undefined : gender.issue.code).toBe("NOT_A_REFERENCE");
  });

  it("gives one level of the element tree, choices by type, without extensions", () => {
    const tree = elementTree(defs, "Patient");
    if (!tree.ok) throw new Error(tree.issue.message);
    const names = tree.value.map((n) => n.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "identifier",
        "active",
        "name",
        "gender",
        "birthDate",
        "deceasedBoolean",
        "deceasedDateTime",
      ]),
    );
    expect(names).not.toContain("extension");
    expect(names).not.toContain("deceased[x]");
    expect(tree.value.find((n) => n.name === "name")).toMatchObject({
      path: "name",
      max: "*",
      expandable: true,
    });
    expect(tree.value.find((n) => n.name === "gender")?.expandable).toBe(false);
    const name = elementTree(defs, "Patient", "name");
    expect(name.ok && name.value.map((n) => n.path)).toEqual(
      expect.arrayContaining(["name.use", "name.text", "name.family", "name.given"]),
    );
    const vitals = elementTree(defs, `${SD}vitalsigns`);
    expect(vitals.ok && vitals.value.find((n) => n.name === "category[VSCat]")).toMatchObject({
      path: "category[VSCat]",
      sliceName: "VSCat",
      min: 1,
    });
  });

  it("loads in the browser only the documents a path needs", async () => {
    const opened = FhirDefinitions.open(manifest);
    if (!opened.ok) throw new Error("not opened");
    const fresh = opened.value;
    const asked: string[] = [];
    const fetch = (file: string) => {
      asked.push(file);
      return Promise.resolve(files.get(file) ?? "");
    };
    const result = await withDefinitions(fresh, fetch, () =>
      resolvePath(fresh, "Observation", "valueCodeableConcept.coding.code"),
    );
    expect(result.ok && result.value.types).toEqual([{ code: "code" }]);
    expect(asked).toEqual([
      "types/Observation.json",
      "types/CodeableConcept.json",
      "types/Coding.json",
    ]);
  });
});
