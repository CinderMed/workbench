import { describe, expect, it } from "vitest";
import { type PackageContents, buildIndex } from "./build-index.js";
import { sha256Hex, utf8Length } from "./hash.js";
import type { IndexIssue, TypeDocument } from "./index-format.js";
import { FHIR, r4Core, sd } from "./test-support/synthetic-packages.js";

function built(packages: PackageContents[], version = "4.0.1") {
  const result = buildIndex(version, packages);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

function doc(files: ReadonlyMap<string, string>, file: string): TypeDocument {
  const text = files.get(file);
  if (text === undefined) throw new Error(`missing ${file}`);
  return JSON.parse(text) as TypeDocument;
}

const codes = (issues: readonly IndexIssue[]) => issues.map((i) => i.code);

describe("buildIndex", () => {
  it("keeps types and profiles, and leaves out extensions, logical models and other resources", () => {
    const { value } = built([r4Core()]);
    expect(value.manifest.entries.map((e) => e.file)).toEqual([
      "profiles/hl7.fhir.r4.core/SimpleQuantity.json",
      "profiles/hl7.fhir.r4.core/vitalsigns.json",
      "types/HumanName.json",
      "types/Patient.json",
      "types/Resource.json",
      "types/code.json",
      "types/string.json",
      "types/uri.json",
    ]);
    expect([...value.files.keys()].sort()).toEqual(value.manifest.entries.map((e) => e.file));
    expect(value.manifest).toMatchObject({
      indexFormat: "1.0.0",
      fhirVersion: "4.0.1",
      packages: [{ id: "hl7.fhir.r4.core", version: "4.0.1" }],
    });
  });

  it("describes each entry, with the digest and size of its document", () => {
    const { value } = built([r4Core()]);
    const patient = value.manifest.entries.find((e) => e.name === "Patient");
    const text = value.files.get("types/Patient.json") ?? "";
    expect(patient).toEqual({
      url: `${FHIR}Patient`,
      name: "Patient",
      type: "Patient",
      kind: "resource",
      abstract: false,
      derivation: "specialization",
      package: "hl7.fhir.r4.core#4.0.1",
      file: "types/Patient.json",
      sha256: sha256Hex(text),
      size: utf8Length(text),
    });
    const root = value.manifest.entries.find((e) => e.name === "Resource");
    expect(root).toMatchObject({ abstract: true });
    expect(root).not.toHaveProperty("derivation");
    expect(value.manifest.entries.find((e) => e.name === "SimpleQuantity")).toMatchObject({
      type: "Quantity",
      derivation: "constraint",
      baseDefinition: `${FHIR}Quantity`,
    });
  });

  it("keeps only the element fields the workbench uses", () => {
    const { value } = built([r4Core()]);
    expect(doc(value.files, "types/Patient.json").elements).toEqual([
      { id: "Patient", min: 0, max: "1", short: "Information about a patient" },
      { id: "Patient.active", min: 0, max: "1", type: [{ code: "boolean" }], isModifier: true },
      { id: "Patient.name", min: 0, max: "*", type: [{ code: "HumanName" }] },
      {
        id: "Patient.gender",
        min: 0,
        max: "1",
        type: [{ code: "code" }],
        binding: {
          strength: "required",
          valueSet: "http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1",
        },
      },
      {
        id: "Patient.generalPractitioner",
        min: 0,
        max: "*",
        type: [
          { code: "Reference", targetProfile: [`${FHIR}Organization`, `${FHIR}Practitioner`] },
        ],
      },
    ]);
  });

  it("keeps slices, slicing, fixed and pattern values with their type, and mustSupport", () => {
    const { value } = built([r4Core()]);
    const vitals = doc(value.files, "profiles/hl7.fhir.r4.core/vitalsigns.json");
    expect(vitals.elements[1]).toEqual({
      id: "Observation.category",
      min: 0,
      max: "*",
      slicing: {
        discriminator: [{ type: "value", path: "coding" }],
        rules: "open",
        ordered: false,
      },
    });
    expect(vitals.elements[2]).toEqual({
      id: "Observation.category:VSCat",
      path: "Observation.category",
      min: 1,
      max: "1",
      sliceName: "VSCat",
      pattern: { type: "CodeableConcept", value: { coding: [{ code: "vital-signs" }] } },
    });
    const quantity = doc(value.files, "profiles/hl7.fhir.r4.core/SimpleQuantity.json");
    expect(quantity.elements[2]).toEqual({
      id: "Quantity.system",
      min: 0,
      max: "1",
      fixed: { type: "uri", value: "http://unitsofmeasure.org" },
      mustSupport: true,
    });
    expect(quantity.elements[0]).toEqual({ id: "Quantity", min: 0, max: "1" });
  });

  it("is deterministic: the same packages in any order give the same bytes", () => {
    const ig: PackageContents = {
      id: "example.ig",
      version: "1.0.0",
      fhirVersions: ["4.0.1"],
      resources: [
        sd(
          "my-patient",
          "resource",
          { Patient: {} },
          { type: "Patient", derivation: "constraint" },
        ),
      ],
    };
    const a = built([r4Core(), ig]).value;
    const b = built([ig, r4Core()]).value;
    expect(a.manifestText).toBe(b.manifestText);
    expect([...a.files]).toEqual([...b.files]);
    expect(a.manifest.packages.map((p) => p.id)).toEqual(["hl7.fhir.r4.core", "example.ig"]);
    expect(a.manifest.entries.find((e) => e.name === "my-patient")).toMatchObject({
      file: "profiles/example.ig/my-patient.json",
      package: "example.ig#1.0.0",
    });
  });

  it("warns about definitions it cannot use, and leaves them out", () => {
    const result = built([
      r4Core([
        sd("NoSnapshot", "resource", {}, { snapshot: undefined }),
        { resourceType: "StructureDefinition", url: "http://example.org/broken", kind: "resource" },
        { resourceType: "StructureDefinition", kind: "resource" },
      ]),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "DEFINITION_WITHOUT_SNAPSHOT",
        subject: `${FHIR}NoSnapshot`,
      }),
      expect.objectContaining({
        severity: "warning",
        code: "DEFINITION_MALFORMED",
        subject: "http://example.org/broken",
      }),
      expect.objectContaining({
        code: "DEFINITION_MALFORMED",
        subject: "hl7.fhir.r4.core#4.0.1: StructureDefinition",
      }),
    ]);
    expect(result.value.manifest.entries.some((e) => e.name === "NoSnapshot")).toBe(false);
  });

  it("needs the core package of a supported FHIR version", () => {
    const unsupported = buildIndex("3.0.2", [r4Core()]);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.issues[0]?.message).toBe("FHIR version 3.0.2 is not supported");
    const missing = buildIndex("5.0.0", [r4Core()]);
    expect(codes(missing.issues)).toEqual(["CORE_PACKAGE_MISSING"]);
    expect(missing.issues[0]?.message).toBe("the core package hl7.fhir.r5.core#5.0.0 is missing");
  });

  it("rejects packages for another FHIR version", () => {
    const r5ig: PackageContents = {
      id: "example.r5",
      version: "1.0.0",
      fhirVersions: ["5.0.0"],
      resources: [],
    };
    const result = buildIndex("4.0.1", [r4Core(), r5ig]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        severity: "error",
        code: "PACKAGE_FHIR_VERSION_MISMATCH",
        message: "package example.r5#1.0.0 is for FHIR 5.0.0, not 4.0.1",
        subject: "example.r5#1.0.0",
      },
    ]);
  });

  it("rejects a definition defined twice", () => {
    const result = buildIndex("4.0.1", [r4Core([sd("Patient", "resource", { Patient: {} })])]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "DEFINITION_DUPLICATE", subject: `${FHIR}Patient` }),
    ]);
  });
});
