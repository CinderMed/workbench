import { describe, expect, expectTypeOf, it } from "vitest";
import metastraManifest from "../../../fixtures/fml-examples/metastra/manifest.json" with { type: "json" };
import motuFall from "../../../fixtures/fml-examples/motu/normalization-Fall.json" with { type: "json" };
import motuProject from "../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import {
  isExportManifest,
  isNormalizationSpec,
  isProjectFile,
  validateProjectSchema,
  type Column,
  type ExportManifest,
  type MappingRow,
  type Normalization,
  type NormalizationSpec,
  type ProjectFile,
} from "./index.js";

/**
 * A minimal project written against the generated types: types and schema must agree on it.
 * Patterns (e.g. ids of 6–64 characters) are checked only at run time, so the ids here respect them.
 */
const column: Column = { id: "col_id", name: "patient_id", dataType: "string" };
const row: MappingRow = {
  id: "map_001",
  code: "R-001",
  columnId: "col_id",
  instanceId: "ins_patient0",
  path: "identifier.value",
  transform: { kind: "copy" },
};
const minimal: ProjectFile = {
  formatVersion: "1.2.0",
  project: {
    id: "prj_minimal",
    name: "Minimal",
    fhirVersion: "4.0.1",
    canonicalBase: "https://example.org/fhir",
  },
  sources: [{ id: "src_table", name: "table", columns: [column] }],
  instances: [
    {
      id: "ins_patient0",
      resourceType: "Patient",
      index: 0,
      sourceId: "src_table",
      multiplicity: { kind: "perRow" },
    },
  ],
  mappings: [row],
  valueMaps: [],
};

describe("generated types", () => {
  it("a project typed as ProjectFile is valid for the schema", () => {
    expect(validateProjectSchema(minimal)).toEqual([]);
  });

  it("reject values the schema rejects", () => {
    // @ts-expect-error: "text" is not a ColumnType
    const wrongType: Column = { id: "c", name: "n", dataType: "text" };
    // @ts-expect-error: FHIR versions are limited to 4.0.1 and 5.0.0
    const wrongVersion: ProjectFile["project"]["fhirVersion"] = "3.0.2";
    expect(
      validateProjectSchema({
        ...minimal,
        sources: [{ id: "s", name: "t", columns: [wrongType] }],
      }),
    ).not.toEqual([]);
    expect(wrongVersion).toBe("3.0.2");
  });

  it("the guards narrow the example documents", () => {
    const project: unknown = motuProject;
    const normalization: unknown = motuFall;
    const manifest: unknown = metastraManifest;
    expect(isProjectFile(project)).toBe(true);
    expect(isNormalizationSpec(normalization)).toBe(true);
    expect(isExportManifest(manifest)).toBe(true);
    if (isProjectFile(project)) expectTypeOf(project).toEqualTypeOf<ProjectFile>();
    if (isNormalizationSpec(normalization))
      expectTypeOf(normalization).toEqualTypeOf<NormalizationSpec>();
    if (isExportManifest(manifest)) expectTypeOf(manifest).toEqualTypeOf<ExportManifest>();
  });

  it("the guards reject invalid documents", () => {
    expect(isProjectFile({})).toBe(false);
    expect(isNormalizationSpec({})).toBe(false);
    expect(isExportManifest({})).toBe(false);
  });

  it("keeps clashing names apart under namespaces", () => {
    expectTypeOf<Normalization.Column>().not.toEqualTypeOf<Column>();
  });
});
