import { describe, expect, it } from "vitest";
import fixtureManifest from "../../../fixtures/fml-examples/manifest.schema.json" with { type: "json" };
import fixtureProject from "../../../fixtures/fml-examples/mapping-project.schema.json" with { type: "json" };
import fixtureNormalization from "../../../fixtures/fml-examples/normalization.schema.json" with { type: "json" };
import {
  MANIFEST_FORMAT_VERSION,
  NORMALIZATION_FORMAT_VERSION,
  PROJECT_FORMAT_VERSION,
  manifestSchema,
  normalizationSchema,
  projectSchema,
} from "./index.js";

// The schemas are contracts: the package copies must never drift from the verified fixtures.
describe("schema copies", () => {
  it.each([
    ["project", projectSchema, fixtureProject],
    ["normalization", normalizationSchema, fixtureNormalization],
    ["manifest", manifestSchema, fixtureManifest],
  ])("the %s schema equals the fixture", (_name, packaged, fixture) => {
    expect(packaged).toStrictEqual(fixture);
  });

  it.each([
    [projectSchema, `mapping-project/${PROJECT_FORMAT_VERSION}`],
    [normalizationSchema, `normalization/${NORMALIZATION_FORMAT_VERSION}`],
    [manifestSchema, `export-manifest/${MANIFEST_FORMAT_VERSION}`],
  ])("the $id ends with the declared format version", (schema, suffix) => {
    expect(schema["$id"]).toMatch(new RegExp(`/${suffix}$`));
  });
});
