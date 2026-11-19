// Reference checks (F4, ADR-0017) on the real core packages, R4 4.0.1 and R5 5.0.0. Runs when
// FHIR_CORE_PACKAGES=1 (the Unit tests job in CI).
import { beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";
import { type FhirDefinitions, validateFhir } from "../packages/fhir-defs/dist/index.js";
import type { Instance, MappingRow, ProjectFile } from "../packages/model/dist/index.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";

const role = (id: string, resourceType: string): Instance => ({
  id,
  resourceType,
  index: 0,
  label: id,
  sourceId: "src",
  multiplicity: { kind: "perRow" },
});
const ref = (n: number, from: string, path: string, to: string): MappingRow => ({
  id: `map_${String(n)}`,
  code: `R-00${String(n)}`,
  instanceId: from,
  path,
  transform: { kind: "reference", targetInstanceId: to },
});

describe.runIf(enabled).each(["4.0.1", "5.0.0"] as const)(
  "references in FHIR %s",
  (fhirVersion) => {
    let defs: FhirDefinitions;
    beforeAll(async () => {
      defs = (await loadDefinitions(fhirVersion, [], { offline: true })).definitions;
    }, 300_000);
    const findings = (instances: Instance[], mappings: MappingRow[]) =>
      validateFhir(
        {
          formatVersion: "1.3.0",
          project: { id: "p", name: "p", fhirVersion, canonicalBase: "http://example.org/fhir" },
          sources: [
            { id: "src", name: "T", columns: [{ id: "c", name: "c", dataType: "string" }] },
          ],
          instances,
          mappings,
          valueMaps: [],
        } satisfies ProjectFile,
        defs,
      )
        .filter((r) =>
          ["REF_TARGET_NOT_ALLOWED", "REFERENCE_REQUIRED_MISSING", "ROLE_ORPHAN"].includes(r.code),
        )
        .map((r) => [r.severity, r.code, r.id]);

    it("accepts a Condition about a Patient, and rejects one about a Practitioner", () => {
      const pat = role("pat", "Patient");
      const doc = role("doc", "Practitioner");
      const cond = role("cond", "Condition");
      expect(findings([pat, cond], [ref(1, "cond", "subject", "pat")])).toEqual([]);
      expect(findings([doc, cond], [ref(1, "cond", "subject", "doc")])).toEqual([
        ["error", "REF_TARGET_NOT_ALLOWED", "map_1"],
      ]);
    });

    it("accepts any target on an element that allows any resource", () => {
      expect(
        findings(
          [role("doc", "Practitioner"), role("obs", "Observation")],
          [ref(1, "obs", "focus", "doc")],
        ),
      ).toEqual([]);
    });

    it("warns about a required reference nothing writes, and about orphan roles", () => {
      const cond = role("cond", "Condition");
      const imm = role("imm", "Immunization");
      expect(
        findings([role("pat", "Patient"), cond, imm], [ref(1, "imm", "patient", "pat")]),
      ).toEqual([
        ["warning", "REFERENCE_REQUIRED_MISSING", "cond"],
        ["warning", "ROLE_ORPHAN", "cond"],
      ]);
    });
  },
);
