import { describe, expect, it } from "vitest";
import metastraManifest from "../../../fixtures/fml-examples/metastra/manifest.json" with { type: "json" };
import metastraNormalization from "../../../fixtures/fml-examples/metastra/normalization-FirstOverview.json" with { type: "json" };
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motuManifest from "../../../fixtures/fml-examples/motu/manifest.json" with { type: "json" };
import motuFall from "../../../fixtures/fml-examples/motu/normalization-Fall.json" with { type: "json" };
import motuHospitalStay from "../../../fixtures/fml-examples/motu/normalization-HospitalStay.json" with { type: "json" };
import motuPatient from "../../../fixtures/fml-examples/motu/normalization-MotuPatient.json" with { type: "json" };
import motuProject from "../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import {
  SCHEMA_VIOLATION,
  isValid,
  validateManifestSchema,
  validateNormalizationSchema,
  validateProjectSchema,
} from "./index.js";

type Json = Record<string, unknown>;

/** Deep copy of an example, typed loosely so tests can break it on purpose. */
function copy(document: unknown): Json {
  return JSON.parse(JSON.stringify(document)) as Json;
}

function list(document: Json, key: string): Json[] {
  return document[key] as Json[];
}

function first(items: Json[]): Json {
  const item = items[0];
  if (item === undefined) throw new Error("empty collection in example");
  return item;
}

describe("validateProjectSchema", () => {
  it.each([
    ["metastra", metastraProject],
    ["motu", motuProject],
  ])("accepts the %s example project", (_name, project) => {
    expect(validateProjectSchema(project)).toEqual([]);
  });

  it("reports a missing top-level key on the project", () => {
    const project = copy(metastraProject);
    delete project["project"];
    const results = validateProjectSchema(project);
    expect(results).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: SCHEMA_VIOLATION,
        objectKind: "project",
        field: "project",
      }),
    );
    expect(isValid(results)).toBe(false);
  });

  it("rejects a format version with another major", () => {
    const project = copy(motuProject);
    project["formatVersion"] = "2.0.0";
    expect(validateProjectSchema(project)).toContainEqual(
      expect.objectContaining({ objectKind: "project", field: "formatVersion" }),
    );
  });

  it("points an unknown property to the mapping row that holds it", () => {
    const project = copy(metastraProject);
    const row = first(list(project, "mappings"));
    row["colour"] = "red";
    expect(validateProjectSchema(project)).toContainEqual(
      expect.objectContaining({
        objectKind: "mapping",
        id: row["id"],
        field: "colour",
        message: expect.stringContaining("'colour'") as unknown,
      }),
    );
  });

  it("points a wrong field to the nested column, not to its source", () => {
    const project = copy(metastraProject);
    const column = first(list(first(list(project, "sources")), "columns"));
    column["dataType"] = "not-a-type";
    expect(validateProjectSchema(project)).toContainEqual(
      expect.objectContaining({ objectKind: "column", id: column["id"], field: "dataType" }),
    );
  });

  it("points a broken value map entry to the entry", () => {
    const project = copy(metastraProject);
    const entry = first(list(first(list(project, "valueMaps")), "entries"));
    delete entry["sourceValue"];
    const results = validateProjectSchema(project);
    expect(results.some((r) => r.objectKind === "valueMapEntry")).toBe(true);
  });

  it("falls back to the collection owner when an item has no id", () => {
    const project = copy(motuProject);
    const instance = first(list(project, "instances"));
    delete instance["id"];
    expect(validateProjectSchema(project)).toContainEqual(
      expect.objectContaining({ objectKind: "instance", field: "id" }),
    );
  });

  it("rejects a document that is not an object", () => {
    expect(validateProjectSchema([])).toContainEqual(
      expect.objectContaining({
        objectKind: "project",
        message: expect.stringMatching(/^\/: /) as unknown,
      }),
    );
  });
});

describe("validateNormalizationSchema", () => {
  it.each([
    ["metastra FirstOverview", metastraNormalization],
    ["motu Fall", motuFall],
    ["motu HospitalStay", motuHospitalStay],
    ["motu MotuPatient", motuPatient],
  ])("accepts the %s normalization", (_name, normalization) => {
    expect(validateNormalizationSchema(normalization)).toEqual([]);
  });

  it("rejects a normalization without formatVersion", () => {
    const normalization = copy(motuFall);
    delete normalization["formatVersion"];
    expect(validateNormalizationSchema(normalization)).toContainEqual(
      expect.objectContaining({ objectKind: "normalization", field: "formatVersion" }),
    );
  });
});

describe("validateManifestSchema", () => {
  it.each([
    ["metastra", metastraManifest],
    ["motu", motuManifest],
  ])("accepts the %s manifest", (_name, manifest) => {
    expect(validateManifestSchema(manifest)).toEqual([]);
  });

  it("rejects an unsupported FHIR version", () => {
    const manifest = copy(metastraManifest);
    manifest["fhirVersion"] = "3.0.2";
    expect(validateManifestSchema(manifest)).toContainEqual(
      expect.objectContaining({ objectKind: "manifest", field: "fhirVersion" }),
    );
  });
});

describe("isValid", () => {
  it("ignores warnings", () => {
    expect(isValid([{ severity: "warning", code: "X", objectKind: "project", message: "m" }])).toBe(
      true,
    );
  });
});
