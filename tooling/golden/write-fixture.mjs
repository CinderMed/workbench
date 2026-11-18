// Writes the generated artifacts of an example in fixtures/fml-examples with the real exporter
// (@cindermed/export), with the options of the export golden test (packages/export/src/golden.test.ts):
// package version 0.1.0, the fixtures' own $schema references, generator cindermed 0.0.0 and a fixed
// createdAt. Fixture maps are produced only by the generator (CLAUDE.md); this is how. Used only in
// dedicated fixtures PRs. The StructureMap JSON committed for an example is the HL7 compilation
// (+ status draft); pass --keep-structuremap to leave an existing one as it is.
// Needs the packages built. Usage: node tooling/golden/write-fixture.mjs <example> [--keep-structuremap]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const [example, flag] = process.argv.slice(2);
if (example === undefined)
  throw new Error("usage: write-fixture.mjs <example> [--keep-structuremap]");
const { exportPackage } = await import(join(root, "packages/export/dist/index.js"));
const dir = join(root, "fixtures/fml-examples", example);
const manifestFile = join(dir, "manifest.json");
const createdAt = existsSync(manifestFile)
  ? JSON.parse(readFileSync(manifestFile, "utf8")).package.createdAt
  : "2026-11-12T00:00:00Z";
const result = exportPackage(readFileSync(join(dir, "project.json"), "utf8"), {
  createdAt,
  packageVersion: "0.1.0",
  generator: { name: "cindermed", version: "0.0.0" },
  schemaRefs: {
    project: "../mapping-project.schema.json",
    normalization: "../normalization.schema.json",
    manifest: "../manifest.schema.json",
  },
});
if (!result.ok) throw new Error(JSON.stringify(result.results, null, 2));
for (const [path, bytes] of result.files) {
  if (path.startsWith("schemas/") || path === "project.json") continue;
  if (
    path.startsWith("StructureMap-") &&
    flag === "--keep-structuremap" &&
    existsSync(join(dir, path))
  )
    continue;
  writeFileSync(join(dir, path), bytes);
  console.log(`wrote ${example}/${path}`);
}
