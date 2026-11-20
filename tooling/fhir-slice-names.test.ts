// Profile slice names (#150, ADR-0020) on the real core packages, R4 4.0.1 and R5 5.0.0: the
// vital signs and blood pressure slices can be written in a project path. Runs when
// FHIR_CORE_PACKAGES=1 (the Unit tests job in CI).
import { beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";
import { type FhirDefinitions, validateFhir } from "../packages/fhir-defs/dist/index.js";
import {
  type MappingRow,
  type ProjectFile,
  validateProjectSchema,
} from "../packages/model/dist/index.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const FHIR = "http://hl7.org/fhir/StructureDefinition/";

const row = (n: number, path: string): MappingRow => ({
  id: `map_00${String(n)}`,
  code: `R-00${String(n)}`,
  instanceId: "role_bp",
  columnId: "col_sys",
  path,
  transform: { kind: "copy" },
});

describe.runIf(enabled).each(["4.0.1", "5.0.0"] as const)(
  "profile slices in FHIR %s",
  (fhirVersion) => {
    let defs: FhirDefinitions;
    beforeAll(async () => {
      defs = (await loadDefinitions(fhirVersion, [], { offline: true })).definitions;
    }, 300_000);

    it("writes category[VSCat], component[SystolicBP] and component[DiastolicBP]", () => {
      const project = {
        formatVersion: "1.4.0",
        project: {
          id: "prj_bp1",
          name: "p",
          fhirVersion,
          canonicalBase: "http://example.org/fhir",
        },
        sources: [
          {
            id: "src_bp1",
            name: "T",
            columns: [{ id: "col_sys", name: "sys", dataType: "string" }],
          },
        ],
        instances: [
          {
            id: "role_bp",
            resourceType: "Observation",
            index: 0,
            profile: `${FHIR}bp`,
            sourceId: "src_bp1",
            multiplicity: { kind: "perRow" },
          },
        ],
        mappings: [
          row(1, "category[VSCat].text"),
          row(2, "component[SystolicBP].code.text"),
          row(3, "component[DiastolicBP].code.text"),
        ],
        valueMaps: [],
      } satisfies ProjectFile;
      expect(validateProjectSchema(project)).toEqual([]);
      const found = validateFhir(project, defs)
        .filter((r) => r.code.startsWith("PATH_") || r.code === "SLICE_NAME_UNUSABLE")
        .map((r) => [r.code, r.id, r.message]);
      expect(found).toEqual([]);
    });
  },
);
