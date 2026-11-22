// The FHIR definitions of the export tests (ADR-0023): the export needs them, and the
// domain-package tests cannot read the core packages from disk, so they use committed subsets of
// the definition index, packages/export/src/test-support/r4-index.json and r5-index.json (#78).
// Each holds the manifest and exactly the documents that exporting the fixture projects of that
// version reads. This test rebuilds them from the real core packages (FHIR_CORE_PACKAGES=1, as in
// the Unit tests job) and fails if a committed one differs; UPDATE_TEST_INDEX=1 writes them again.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FhirDefinitions, loadProjectDefinitions } from "../packages/fhir-defs/dist/index.js";
import { parseProject } from "../packages/model/dist/index.js";
import { writtenPaths } from "../packages/export/src/written-paths.js";
import { describe, expect, it } from "vitest";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const root = resolve(import.meta.dirname, "..");
const targetOf = (release: string) =>
  join(root, `packages/export/src/test-support/${release}-index.json`);
const fixtures = join(root, "fixtures/fml-examples");

/** Every fixture project of a FHIR version. */
function fixtureProjects(fhirVersion: string) {
  return readdirSync(fixtures, { withFileTypes: true }).flatMap((dir) => {
    if (!dir.isDirectory()) return [];
    try {
      const parsed = parseProject(readFileSync(join(fixtures, dir.name, "project.json"), "utf8"));
      return parsed.project?.project.fhirVersion === fhirVersion ? [parsed.project] : [];
    } catch {
      return [];
    }
  });
}

describe.runIf(enabled).each([
  { fhirVersion: "4.0.1", release: "r4", minimum: 5 },
  { fhirVersion: "5.0.0", release: "r5", minimum: 1 },
])("the $release definitions of the export tests", ({ fhirVersion, release, minimum }) => {
  it("are the documents exporting the fixtures reads, from the core package", async () => {
    const { index } = await loadDefinitions(fhirVersion, []);
    const read = new Set<string>();
    const fetch = (file: string) => {
      const text = index.files.get(file);
      if (text === undefined) return Promise.reject(new Error(`${file}: not in the index`));
      read.add(file);
      return Promise.resolve(text);
    };
    const projects = fixtureProjects(fhirVersion);
    expect(projects.length).toBeGreaterThanOrEqual(minimum);
    for (const project of projects) {
      const opened = FhirDefinitions.open(index.manifest);
      if (!opened.ok) throw new Error("manifest");
      await loadProjectDefinitions(project, opened.value, fetch);
      writtenPaths(project, opened.value); // Every path the generator writes resolves.
    }
    const subset = {
      fhirVersion,
      manifest: index.manifestText,
      files: Object.fromEntries([...read].sort().map((file) => [file, index.files.get(file)])),
    };
    const text = `${JSON.stringify(subset, null, 1)}\n`;
    const target = targetOf(release);
    if (process.env["UPDATE_TEST_INDEX"] === "1") writeFileSync(target, text);
    expect(readFileSync(target, "utf8")).toBe(text);
  }, 300_000);
});
