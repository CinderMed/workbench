// The R4 definitions of the export tests (ADR-0023): the export needs the FHIR definitions, and the
// domain-package tests cannot read the core package from disk, so they use a committed subset of
// the R4 definition index, packages/export/src/test-support/r4-index.json. It holds the manifest and
// exactly the documents that exporting the fixture projects reads. This test rebuilds it from the
// real core package (FHIR_CORE_PACKAGES=1, as in the Unit tests job) and fails if the committed
// one differs; UPDATE_TEST_INDEX=1 writes it again.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FhirDefinitions, loadProjectDefinitions } from "../packages/fhir-defs/dist/index.js";
import { parseProject } from "../packages/model/dist/index.js";
import { writtenPaths } from "../packages/export/src/written-paths.js";
import { describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const root = resolve(import.meta.dirname, "..");
const target = join(root, "packages/export/src/test-support/r4-index.json");
const fixtures = join(root, "fixtures/fml-examples");

/** Every fixture project of FHIR R4. */
function fixtureProjects() {
  return readdirSync(fixtures, { withFileTypes: true }).flatMap((dir) => {
    if (!dir.isDirectory()) return [];
    try {
      const parsed = parseProject(readFileSync(join(fixtures, dir.name, "project.json"), "utf8"));
      return parsed.project?.project.fhirVersion === "4.0.1" ? [parsed.project] : [];
    } catch {
      return [];
    }
  });
}

describe.runIf(enabled)("the R4 definitions of the export tests", () => {
  it("are the documents exporting the fixtures reads, from the core package", async () => {
    const { index } = await loadDefinitions("4.0.1", []);
    const read = new Set<string>();
    const fetch = (file: string) => {
      const text = index.files.get(file);
      if (text === undefined) return Promise.reject(new Error(`${file}: not in the index`));
      read.add(file);
      return Promise.resolve(text);
    };
    const projects = fixtureProjects();
    expect(projects.length).toBeGreaterThan(4);
    for (const project of projects) {
      const opened = FhirDefinitions.open(index.manifest);
      if (!opened.ok) throw new Error("manifest");
      await loadProjectDefinitions(project, opened.value, fetch);
      writtenPaths(project, opened.value); // Every path the generator writes resolves.
    }
    const subset = {
      fhirVersion: "4.0.1",
      manifest: index.manifestText,
      files: Object.fromEntries([...read].sort().map((file) => [file, index.files.get(file)])),
    };
    const text = `${JSON.stringify(subset, null, 1)}\n`;
    if (process.env["UPDATE_TEST_INDEX"] === "1") writeFileSync(target, text);
    expect(readFileSync(target, "utf8")).toBe(text);
  }, 300_000);
});
