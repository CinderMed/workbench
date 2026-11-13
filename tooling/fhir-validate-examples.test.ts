// The FHIR-level path checks (D7, ADR-0014) on every verified example project, with the real core
// package of its FHIR version: the examples were verified with the HL7 engine, so every path they
// write must resolve. Runs when FHIR_CORE_PACKAGES=1 (the Unit tests job in CI).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseProject } from "../packages/model/dist/index.js";
import { describe, expect, it } from "vitest";
import { ExitCode, run } from "../apps/cli/src/cli.js";
import { loadDefinitions } from "../apps/cli/src/fhir-packages.js";
import { validateFhir } from "../packages/fhir-defs/dist/index.js";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const fixtures = resolve(import.meta.dirname, "../fixtures/fml-examples");
const examples = readdirSync(fixtures, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(fixtures, e.name, "project.json")))
  .map((e) => e.name);

describe.runIf(enabled)("FHIR path checks on the verified examples", () => {
  it.each(examples)(
    "%s: every path resolves",
    async (name) => {
      const parsed = parseProject(readFileSync(join(fixtures, name, "project.json"), "utf8"));
      const project = parsed.project;
      if (project === undefined) throw new Error(JSON.stringify(parsed.results));
      const { definitions } = await loadDefinitions(project.project.fhirVersion, [], {
        offline: true,
      });
      expect(validateFhir(project, definitions)).toEqual([]);
    },
    300_000,
  );

  it.each(examples)(
    "%s: cindermed validate --offline says valid",
    async (name) => {
      const path = join(fixtures, name, "project.json");
      let out = "";
      let err = "";
      const code = await run(["validate", path, "--offline"], {
        readFile: (file) => Promise.resolve(readFileSync(file, "utf8")),
        stdout: (text) => (out += text),
        stderr: (text) => (err += text),
        writeFile: () => Promise.reject(new Error("validate writes nothing")),
        now: () => new Date(),
        version: "0.0.0",
        loadDefinitions,
      });
      expect([code, out, err]).toEqual([ExitCode.OK, `${path}: valid (format 1.3.0)\n`, ""]);
    },
    300_000,
  );
});
