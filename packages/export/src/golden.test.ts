// Golden test of the export package (G7, ADR-0012) on the verified examples. The fixtures'
// manifests were written by this exporter with packageVersion 0.1.0, the fixtures' own $schema
// references and each manifest's createdAt; the generated artifacts must equal the fixture files.
import { parseProject, serializeProject, type ExportManifest } from "@cindermed/model";
import { strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import namesManifest from "../../../fixtures/fml-examples/element-names/manifest.json?raw";
import namesProject from "../../../fixtures/fml-examples/element-names/project.json?raw";
import visitManifest from "../../../fixtures/fml-examples/boolean-value-map/manifest.json?raw";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json?raw";
import manifestSchemaText from "../../../fixtures/fml-examples/manifest.schema.json?raw";
import projectSchemaText from "../../../fixtures/fml-examples/mapping-project.schema.json?raw";
import metastraManifest from "../../../fixtures/fml-examples/metastra/manifest.json?raw";
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json?raw";
import mimicManifest from "../../../fixtures/fml-examples/mimic-iv-demo/manifest.json?raw";
import mimicProject from "../../../fixtures/fml-examples/mimic-iv-demo/project.json?raw";
import motuManifest from "../../../fixtures/fml-examples/motu/manifest.json?raw";
import motuProject from "../../../fixtures/fml-examples/motu/project.json?raw";
import normalizationSchemaText from "../../../fixtures/fml-examples/normalization.schema.json?raw";
import { cleanProject, exportPackage } from "./index.js";

/** Fixture files, by folder and name (Vite glob of the raw text). */
const fixtureFiles = import.meta.glob<string>(
  "../../../fixtures/fml-examples/*/{*.map,StructureMap-*.json,StructureDefinition-*.json,normalization-*.json,ConceptMap-*.json}",
  { query: "?raw", import: "default", eager: true },
);
const fixture = (folder: string, name: string): string | undefined =>
  fixtureFiles[`../../../fixtures/fml-examples/${folder}/${name}`];
const fixtureNames = (folder: string): string[] =>
  Object.keys(fixtureFiles)
    .filter((path) => path.startsWith(`../../../fixtures/fml-examples/${folder}/`))
    .map((path) => path.split("/").at(-1) ?? path);

const refs = {
  project: "../mapping-project.schema.json",
  normalization: "../normalization.schema.json",
  manifest: "../manifest.schema.json",
};
const schemas: Record<string, string> = {
  "schemas/mapping-project.schema.json": projectSchemaText,
  "schemas/normalization.schema.json": normalizationSchemaText,
  "schemas/manifest.schema.json": manifestSchemaText,
};

describe.each([
  ["metastra", metastraProject, metastraManifest],
  ["motu", motuProject, motuManifest],
  ["boolean-value-map", visitProject, visitManifest],
  ["mimic-iv-demo", mimicProject, mimicManifest],
  ["element-names", namesProject, namesManifest],
])("export of %s", (folder, projectText, manifestText) => {
  const expected = JSON.parse(manifestText) as ExportManifest;
  const result = exportPackage(projectText, {
    createdAt: expected.package.createdAt,
    packageVersion: "0.1.0",
    generator: expected.package.generator,
    schemaRefs: refs,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.results));
  const text = (path: string) => strFromU8(result.files.get(path) ?? new Uint8Array());

  it("writes the committed manifest", () => {
    expect(text("manifest.json")).toBe(manifestText);
  });

  it("writes the maps, logical models, normalization specifications and ConceptMaps byte for byte", () => {
    const generated = [...result.files.keys()].filter(
      (p) => !p.startsWith("schemas/") && !p.startsWith("StructureMap-"),
    );
    const names = fixtureNames(folder).filter((n) => !n.startsWith("StructureMap-"));
    expect(generated.filter((p) => p !== "project.json" && p !== "manifest.json").sort()).toEqual(
      names.sort(),
    );
    for (const name of names) expect(text(name), name).toBe(fixture(folder, name));
  });

  it("writes StructureMap JSON with the content the HL7 engine compiled (+ status draft)", () => {
    const maps = [...result.files.keys()].filter((p) => p.startsWith("StructureMap-"));
    expect(maps.length).toBeGreaterThan(0);
    for (const path of maps)
      expect(JSON.parse(text(path)), path).toEqual(JSON.parse(fixture(folder, path) ?? "{}"));
  });

  it("writes the cleaned project and the three schemas", () => {
    const parsed = parseProject(projectText).project;
    if (parsed === undefined) throw new Error("fixture project is not valid");
    expect(text("project.json")).toBe(
      serializeProject({ ...cleanProject(parsed), $schema: refs.project }),
    );
    for (const [path, content] of Object.entries(schemas))
      expect(JSON.parse(text(path))).toEqual(JSON.parse(content));
  });
});
