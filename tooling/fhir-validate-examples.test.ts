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
/**
 * Warnings an example gives on purpose: type-combinations covers the cells of the compatibility
 * table that are allowed with a warning (TYPE_PRECISION), one each. Every other example gives none.
 */
const EXPECTED_WARNINGS: Readonly<Record<string, number>> = { "type-combinations": 10 };

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
      const results = validateFhir(project, definitions);
      expect(results.filter((r) => r.severity === "error")).toEqual([]);
      const warnings = results.filter((r) => r.severity === "warning");
      expect(warnings.map((r) => r.code)).toEqual(
        Array.from({ length: EXPECTED_WARNINGS[name] ?? 0 }, () => "TYPE_PRECISION"),
      );
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
      const warnings = EXPECTED_WARNINGS[name] ?? 0;
      const summary = warnings === 0 ? "" : `, ${String(warnings)} warnings`;
      expect([code, out.split("\n")[0], err]).toEqual([
        ExitCode.OK,
        `${path}: valid (format 1.3.0)${summary}`,
        "",
      ]);
    },
    300_000,
  );

  // Done-when of module 3: "cindermed validate flags the boolean on Patient.name".
  it.each([
    ["name", ExitCode.INVALID],
    ["active", ExitCode.OK],
  ])(
    "a boolean column copied to Patient.%s",
    async (path, expected) => {
      const project = JSON.parse(
        readFileSync(join(fixtures, "boolean-value-map", "project.json"), "utf8"),
      ) as {
        sources: { columns: Record<string, unknown>[] }[];
        mappings: Record<string, unknown>[];
      };
      project.sources[0]?.columns.push({ id: "col_flag", name: "flag", dataType: "boolean" });
      project.mappings.push({
        id: "map_flag",
        code: "R-099",
        columnId: "col_flag",
        instanceId: "ins_patient0",
        path,
        transform: { kind: "copy" },
      });
      let out = "";
      const code = await run(["validate", "flag.json", "--offline"], {
        readFile: () => Promise.resolve(JSON.stringify(project)),
        stdout: (text) => (out += text),
        stderr: (text) => (out += text),
        writeFile: () => Promise.reject(new Error("validate writes nothing")),
        now: () => new Date(),
        version: "0.0.0",
        loadDefinitions,
      });
      expect(code).toBe(expected);
      expect(out).toBe(
        expected === ExitCode.OK
          ? "flag.json: valid (format 1.3.0)\n"
          : "flag.json: 1 error\n" +
              "  error COMPLEX_TARGET mapping map_flag (path): R-099: column flag (boolean) cannot be copied to Patient.name (HumanName), a complex type: no element of HumanName takes a boolean value\n",
      );
    },
    300_000,
  );
});
