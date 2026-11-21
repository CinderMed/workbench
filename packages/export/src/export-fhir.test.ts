// The FHIR level in the export (D7): with definitions, its errors block the export.
import { FhirDefinitions, buildIndex } from "@cindermed/fhir-defs";
import { describe, expect, it } from "vitest";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json?raw";
import { exportPackage } from "./export-package.js";
import { r4Definitions } from "./test-support/r4-definitions.js";

/** Definitions of FHIR 5.0.0 with no types: enough to show that the FHIR level runs. */
function r5Definitions(): FhirDefinitions {
  const index = buildIndex("5.0.0", [
    { id: "hl7.fhir.r5.core", version: "5.0.0", fhirVersions: ["5.0.0"], resources: [] },
  ]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  return opened.value;
}

const options = { createdAt: "2026-11-12T00:00:00Z", generator: { name: "test", version: "0" } };

describe("exportPackage with FHIR definitions", () => {
  it("blocks the export on FHIR errors", () => {
    const result = exportPackage(visitProject, { ...options, definitions: r5Definitions() });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.results.map((r) => r.code)).toEqual(["FHIR_VERSION_MISMATCH"]);
  });

  it("exports with the project's definitions (always needed, ADR-0023)", () => {
    expect(exportPackage(visitProject, { ...options, definitions: r4Definitions() }).ok).toBe(true);
  });
});
