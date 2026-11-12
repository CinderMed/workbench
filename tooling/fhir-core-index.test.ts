// The compact definition index (ADR-0013) built from the real core packages, hl7.fhir.r4.core
// 4.0.1 and hl7.fhir.r5.core 5.0.0, read from the FHIR package cache (~/.fhir/packages) or
// downloaded and checked against their pinned SHA-256. Runs when FHIR_CORE_PACKAGES=1 (the Unit
// tests job in CI, with the package cache cached).
import { describe, expect, it } from "vitest";
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
