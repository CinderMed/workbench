import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportPackage, mappingTables, toCsv, toXlsx } from "@cindermed/export";
import { parseProject } from "@cindermed/model";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDefinitions } from "./fhir-packages.js";
import { type CliIo, ExitCode, USAGE, packageName, run } from "./index.js";

const examples = fileURLToPath(new URL("../../../fixtures/fml-examples/", import.meta.url));

interface Captured {
  readonly io: CliIo;
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Files written by the command, kept in memory (nothing reaches the disk). */
  readonly written: Map<string, Uint8Array>;
}

/** Real file reads (fixtures only, never written), captured output and writes, a fixed clock. */
function capture(files: Readonly<Record<string, string | Uint8Array>> = {}): Captured {
  let out = "";
  let err = "";
  const written = new Map<string, Uint8Array>();
  return {
    io: {
      readFile: async (path) => {
        const file = files[path];
        if (file === undefined) return readFile(path, "utf8");
        return typeof file === "string" ? file : new TextDecoder().decode(file);
      },
      readChunks: (path) => chunks(files[path] ?? readFileSync(path)),
      exists: (path) => Promise.resolve(path in files || written.has(path)),
      stdout: (text) => (out += text),
      stderr: (text) => (err += text),
      writeFile: (path, data) => {
        written.set(path, data);
        return Promise.resolve();
      },
      now: () => new Date("2026-11-12T08:30:15.987Z"),
      version: "9.9.9",
      // Unit tests never download FHIR packages: tests that need definitions give a cache.
      loadDefinitions: () => Promise.reject(new Error("no FHIR packages in this test")),
    },
    stdout: () => out,
    stderr: () => err,
    written,
  };
}

/** A file in chunks of 7 bytes, so records and characters are split across chunks. */
async function* chunks(file: string | Uint8Array): AsyncIterable<Uint8Array> {
  const bytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
  for (let i = 0; i < bytes.length; i += 7) {
    await Promise.resolve();
    yield bytes.slice(i, i + 7);
  }
}

async function exampleText(name: string): Promise<string> {
  return readFile(`${examples}${name}/project.json`, "utf8");
}

describe("cindermed validate", () => {
  it.each(["metastra", "motu"])("accepts the %s example project", async (name) => {
    const path = `${examples}${name}/project.json`;
    const cli = capture();
    expect(await run(["validate", path, "--no-fhir"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(
      `${path}: valid (format 1.4.0)\n  note: FHIR checks skipped (--no-fhir)\n`,
    );
    expect(cli.stderr()).toBe("");
  });

  it("lists the errors of an invalid project and exits with 1", async () => {
    const project = JSON.parse(await exampleText("motu")) as {
      mappings: { code: string }[];
    };
    const [first, second] = project.mappings;
    if (first === undefined || second === undefined) throw new Error("motu needs two rows");
    second.code = first.code;
    const cli = capture({ "broken.json": JSON.stringify(project) });

    expect(await run(["validate", "broken.json", "--no-fhir"], cli.io)).toBe(ExitCode.INVALID);
    const lines = cli.stdout().trimEnd().split("\n");
    expect(lines[0]).toBe("broken.json: 1 error");
    expect(lines[2]).toMatch(/^ {2}error DUPLICATE_ROW_CODE mapping \S+ \(code\): /);
  });

  it("reports text that is not JSON", async () => {
    const cli = capture({ "bad.json": "{" });
    expect(await run(["validate", "bad.json"], cli.io)).toBe(ExitCode.INVALID);
    expect(cli.stdout()).toContain("bad.json: 1 error\n  error INVALID_JSON project: ");
  });

  it("writes a JSON report with --format json", async () => {
    const path = `${examples}motu/project.json`;
    const cli = capture();
    expect(await run(["validate", path, "--format", "json", "--no-fhir"], cli.io)).toBe(
      ExitCode.OK,
    );
    expect(JSON.parse(cli.stdout())).toEqual({
      file: path,
      valid: true,
      formatVersion: "1.4.0",
      fhir: { checks: "skipped", packages: [] },
      results: [],
    });
  });

  it("notes a project read from an older minor format", async () => {
    const project = JSON.parse(await exampleText("motu")) as Record<string, unknown>;
    const cli = capture({ "old.json": JSON.stringify({ ...project, formatVersion: "1.1.0" }) });
    expect(await run(["validate", "old.json", "--no-fhir"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(
      "old.json: valid (format 1.4.0)\n  note: read as format 1.4.0 (file has 1.1.0)\n" +
        "  note: FHIR checks skipped (--no-fhir)\n",
    );
  });

  it("includes migratedFrom and the errors in the JSON report", async () => {
    const cli = capture({ "old.json": JSON.stringify({ formatVersion: "1.0.0" }) });
    expect(await run(["validate", "--format=json", "old.json"], cli.io)).toBe(ExitCode.INVALID);
    const report = JSON.parse(cli.stdout()) as {
      valid: boolean;
      migratedFrom: string;
      results: unknown[];
    };
    expect(report.valid).toBe(false);
    expect(report.migratedFrom).toBe("1.0.0");
    expect(report.results.length).toBeGreaterThan(0);
    // The schema failed: the FHIR checks did not run, and no definitions were loaded.
    expect((report as unknown as { fhir: unknown }).fhir).toEqual({
      checks: "not run",
      packages: [],
    });
  });

  it("exits with 2 when the file cannot be read", async () => {
    const cli = capture();
    expect(await run(["validate", `${examples}missing.json`], cli.io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toBe(`cindermed: cannot read ${examples}missing.json (ENOENT)\n`);
    expect(cli.stdout()).toBe("");
  });

  it("names a read failure without an error code", async () => {
    const cli = capture();
    const io: CliIo = { ...cli.io, readFile: () => Promise.reject(new Error("boom")) };
    expect(await run(["validate", "x.json"], io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toBe("cindermed: cannot read x.json (read error)\n");
  });
});

/** A StructureDefinition with a snapshot of these elements (path → extra fields). */
function sd(name: string, kind: string, elements: Record<string, Record<string, unknown>>) {
  return {
    resourceType: "StructureDefinition",
    id: name,
    url: `http://hl7.org/fhir/StructureDefinition/${name}`,
    name,
    type: name,
    kind,
    abstract: false,
    derivation: "specialization",
    snapshot: {
      element: Object.entries(elements).map(([path, fields]) => ({
        id: path,
        path,
        min: 0,
        max: "1",
        ...fields,
      })),
    },
  };
}
const typed = (...codes: string[]) => ({ type: codes.map((code) => ({ code })) });

/**
 * A small hl7.fhir.r4.core in a temporary FHIR package cache: just the elements the
 * boolean-value-map example writes, so the real loader and checks run without the real package.
 */
async function syntheticCache(): Promise<string> {
  const cache = await mkdtemp(join(tmpdir(), "cindermed-cli-fhir-"));
  const folder = join(cache, "hl7.fhir.r4.core#4.0.1", "package");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ name: "hl7.fhir.r4.core", version: "4.0.1", fhirVersions: ["4.0.1"] }),
  );
  const definitions = [
    ...["string", "code", "boolean", "uri"].map((p) => sd(p, "primitive-type", { [p]: {} })),
    sd("Identifier", "complex-type", { Identifier: {}, "Identifier.value": typed("string") }),
    sd("Coding", "complex-type", { Coding: {}, "Coding.code": typed("code") }),
    sd("CodeableConcept", "complex-type", {
      CodeableConcept: {},
      "CodeableConcept.coding": { max: "*", ...typed("Coding") },
    }),
    sd("Reference", "complex-type", { Reference: {}, "Reference.reference": typed("string") }),
    sd("Patient", "resource", {
      Patient: {},
      "Patient.identifier": { max: "*", ...typed("Identifier") },
    }),
    sd("Observation", "resource", {
      Observation: {},
      "Observation.status": typed("code"),
      "Observation.code": typed("CodeableConcept"),
      "Observation.subject": {
        type: [
          { code: "Reference", targetProfile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
        ],
      },
      "Observation.value[x]": typed("boolean", "string"),
    }),
  ];
  for (const definition of definitions)
    await writeFile(
      join(folder, `StructureDefinition-${definition.id}.json`),
      JSON.stringify(definition),
    );
  return cache;
}

describe("cindermed validate, FHIR checks", () => {
  let cache: string;
  beforeAll(async () => {
    cache = await syntheticCache();
  });
  afterAll(async () => {
    await rm(cache, { recursive: true, force: true });
  });
  const visit = `${examples}boolean-value-map/project.json`;
  const withLoader = (files: Readonly<Record<string, string>> = {}) => {
    const cli = capture(files);
    return { ...cli, io: { ...cli.io, loadDefinitions } };
  };

  it("checks the paths against the FHIR definitions, from the cache given", async () => {
    const cli = withLoader();
    expect(await run(["validate", visit, "--fhir-cache", cache, "--offline"], cli.io)).toBe(
      ExitCode.OK,
    );
    expect(cli.stdout()).toBe(`${visit}: valid (format 1.4.0)\n`);
    const json = withLoader();
    expect(
      await run(
        ["validate", visit, "--fhir-cache", cache, "--offline", "--format", "json"],
        json.io,
      ),
    ).toBe(ExitCode.OK);
    expect((JSON.parse(json.stdout()) as { fhir: unknown }).fhir).toEqual({
      checks: "done",
      packages: ["hl7.fhir.r4.core#4.0.1"],
    });
  });

  it("reports a path that is not in the definitions, and exits with 1", async () => {
    const project = JSON.parse(await exampleText("boolean-value-map")) as {
      mappings: { path: string }[];
    };
    const row = project.mappings[1];
    if (row === undefined) throw new Error("the example needs a second row");
    row.path = "valueBooleen";
    const cli = withLoader({ "typo.json": JSON.stringify(project) });
    expect(await run(["validate", "typo.json", "--fhir-cache", cache, "--offline"], cli.io)).toBe(
      ExitCode.INVALID,
    );
    expect(cli.stdout()).toBe(
      "typo.json: 1 error\n" +
        "  error PATH_NOT_FOUND mapping map_0002 (path): R-002: Observation.valueBooleen: valueBooleen is not an element of Observation\n",
    );
  });

  it("passes the project's FHIR version, packages and the options to the loader", async () => {
    const project = JSON.parse(await exampleText("boolean-value-map")) as {
      project: Record<string, unknown>;
    };
    project.project["packages"] = [{ name: "example.ig", version: "1.0.0" }];
    const cli = capture({ "ig.json": JSON.stringify(project) });
    const calls: unknown[] = [];
    const io: CliIo = {
      ...cli.io,
      loadDefinitions: (...args) => {
        calls.push(args);
        return Promise.reject(new Error("example.ig#1.0.0 is not in the FHIR package cache"));
      },
    };
    expect(await run(["validate", "ig.json", "--offline", "--fhir-cache", "/cache"], io)).toBe(
      ExitCode.USAGE,
    );
    expect(calls).toEqual([
      ["4.0.1", [{ id: "example.ig", version: "1.0.0" }], { offline: true, cacheDir: "/cache" }],
    ]);
    expect(cli.stderr()).toBe(
      "cindermed: cannot load the FHIR definitions for ig.json: example.ig#1.0.0 is not in the FHIR package cache\n" +
        "  use --fhir-cache <folder> for a cache that holds the packages, or --no-fhir to skip the FHIR checks\n",
    );
    expect(cli.stdout()).toBe("");
  });

  it("blocks an export with FHIR errors, and exports a project without them", async () => {
    const out = [
      "--package-version",
      "0.1.0",
      "--created-at",
      "2026-11-12T00:00:00Z",
      "--out",
      "pkg.zip",
    ];
    const good = withLoader();
    expect(await run(["export", visit, ...out, "--fhir-cache", cache, "--offline"], good.io)).toBe(
      ExitCode.OK,
    );
    expect([...good.written.keys()]).toEqual(["pkg.zip"]);

    const project = JSON.parse(await exampleText("boolean-value-map")) as {
      sources: { columns: Record<string, unknown>[] }[];
      mappings: Record<string, unknown>[];
    };
    project.sources[0]?.columns.push({ id: "col_flag", name: "flag", dataType: "boolean" });
    project.mappings.push({
      id: "map_flag",
      code: "R-099",
      columnId: "col_flag",
      instanceId: "ins_patient0",
      path: "identifier",
      transform: { kind: "copy" },
    });
    const bad = withLoader({ "flag.json": JSON.stringify(project) });
    expect(
      await run(["export", "flag.json", ...out, "--fhir-cache", cache, "--offline"], bad.io),
    ).toBe(ExitCode.INVALID);
    expect(bad.written.size).toBe(0);
    expect(bad.stdout()).toBe(
      "flag.json: export blocked, 1 error\n" +
        "  error COMPLEX_TARGET mapping map_flag (path): R-099: column flag (boolean) cannot be copied to Patient.identifier (Identifier), a complex type: no element of Identifier takes a boolean value\n",
    );
    const json = withLoader({ "flag.json": JSON.stringify(project) });
    await run(
      ["export", "flag.json", ...out, "--fhir-cache", cache, "--offline", "--format", "json"],
      json.io,
    );
    expect(JSON.parse(json.stdout())).toMatchObject({
      ok: false,
      fhir: { checks: "done", packages: ["hl7.fhir.r4.core#4.0.1"] },
      results: [{ code: "COMPLEX_TARGET" }],
    });
  });

  it("downloads by default, and never loads definitions with --no-fhir", async () => {
    const cli = capture();
    const calls: unknown[] = [];
    const io: CliIo = {
      ...cli.io,
      loadDefinitions: (...args) => {
        calls.push(args);
        return Promise.reject(new Error("offline"));
      },
    };
    expect(await run(["validate", visit], io)).toBe(ExitCode.USAGE);
    expect(calls).toEqual([["4.0.1", [], { offline: false }]]);
    expect(await run(["validate", visit, "--no-fhir"], io)).toBe(ExitCode.OK);
    expect(calls).toHaveLength(1);
  });
});

describe("cindermed usage", () => {
  it("prints the help with --help", async () => {
    const cli = capture();
    expect(await run(["--help"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(USAGE);
  });

  it.each([
    [[], "missing command"],
    [["convert", "p.json"], "unknown command 'convert'"],
    [["validate"], "validate needs a project file"],
    [["validate", "a.json", "b.json"], "unexpected argument 'b.json'"],
    [["validate", "a.json", "--format", "xml"], "unknown format 'xml'"],
    [["validate", "a.json", "--verbose"], "Unknown option '--verbose'"],
  ])("rejects %j with exit code 2", async (args, message) => {
    const cli = capture();
    expect(await run(args, cli.io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toContain(message);
    expect(cli.stderr()).toContain(USAGE);
    expect(cli.stdout()).toBe("");
  });

  it("exposes its package name", () => {
    expect(packageName).toBe("@cindermed/cli");
  });
});

describe("cindermed export", () => {
  const motu = `${examples}motu/project.json`;
  const fixed = ["--package-version", "0.1.0", "--created-at", "2026-11-12T00:00:00Z", "--no-fhir"];

  it("writes the deterministic zip of the export package", async () => {
    const cli = capture();
    expect(await run(["export", motu, ...fixed, "--out", "out/motu.zip"], cli.io)).toBe(
      ExitCode.OK,
    );
    const expected = exportPackage(await exampleText("motu"), {
      createdAt: "2026-11-12T00:00:00Z",
      packageVersion: "0.1.0",
      generator: { name: "cindermed", version: "9.9.9" },
    });
    if (!expected.ok) throw new Error("fixture export failed");
    expect([...cli.written.keys()]).toEqual(["out/motu.zip"]);
    expect(cli.written.get("out/motu.zip")).toEqual(expected.zip);
    expect(cli.stdout()).toBe(
      `${motu}: exported motu-mapping 0.1.0 to out/motu.zip (18 files)\n` +
        "  note: FHIR checks skipped (--no-fhir)\n",
    );
  });

  it("writes the files into a folder when --out does not end in .zip", async () => {
    const cli = capture();
    expect(await run(["export", motu, ...fixed, "--out", "pkg/"], cli.io)).toBe(ExitCode.OK);
    const paths = [...cli.written.keys()];
    expect(paths).toContain("pkg/manifest.json");
    expect(paths).toContain("pkg/schemas/manifest.schema.json");
    expect(paths).toHaveLength(18);
    const manifest = JSON.parse(new TextDecoder().decode(cli.written.get("pkg/manifest.json"))) as {
      package: { generator: { version: string } };
    };
    expect(manifest.package.generator).toEqual({ name: "cindermed", version: "9.9.9" });
  });

  it("uses a dev version from the project, the clock and the package name by default", async () => {
    const cli = capture();
    expect(await run(["export", motu, "--no-fhir"], cli.io)).toBe(ExitCode.OK);
    const [out] = [...cli.written.keys()];
    expect(out).toMatch(/^motu-mapping-0\.0\.0-dev\.[0-9a-f]{12}\.zip$/);
    const entries = unzipSync(cli.written.get(out ?? "") ?? new Uint8Array());
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
      package: { createdAt: string };
    };
    expect(manifest.package.createdAt).toBe("2026-11-12T08:30:15Z");
  });

  it("reports in JSON", async () => {
    const cli = capture();
    expect(await run(["export", motu, ...fixed, "--format", "json"], cli.io)).toBe(ExitCode.OK);
    expect(JSON.parse(cli.stdout())).toMatchObject({
      file: motu,
      ok: true,
      out: "motu-mapping-0.1.0.zip",
      package: { name: "motu-mapping", version: "0.1.0", createdAt: "2026-11-12T00:00:00Z" },
      warnings: [],
    });
  });

  it("blocks a project with errors, writes nothing and exits with 1", async () => {
    const broken = JSON.parse(await exampleText("motu")) as { mappings: { code: string }[] };
    const [first, second] = broken.mappings;
    if (first === undefined || second === undefined) throw new Error("fixture changed");
    second.code = first.code;
    const cli = capture({ "broken.json": JSON.stringify(broken) });
    expect(await run(["export", "broken.json", ...fixed], cli.io)).toBe(ExitCode.INVALID);
    expect(cli.written.size).toBe(0);
    expect(cli.stdout()).toMatch(
      /^broken\.json: export blocked, 1 error\n {2}note: FHIR checks skipped \(--no-fhir\)\n {2}error DUPLICATE_ROW_CODE/,
    );
    const json = capture({ "broken.json": JSON.stringify(broken) });
    await run(["export", "broken.json", "--format", "json", "--no-fhir"], json.io);
    expect(JSON.parse(json.stdout())).toMatchObject({
      ok: false,
      fhir: { checks: "skipped", packages: [] },
      results: [{ code: "DUPLICATE_ROW_CODE" }],
    });
  });

  it.each([
    [["export"], "export needs a project file"],
    [["export", "p.json", "--package-version", "latest"], "--package-version must be a version"],
    [
      ["export", "p.json", "--created-at", "2026-11-12"],
      "--created-at must be an ISO 8601 date-time",
    ],
    [["validate", "p.json", "--out", "x.zip"], "--out does not apply to validate"],
    [["mapping-table", "p.json", "--offline"], "--offline does not apply to mapping-table"],
    [["mapping-table", "p.json", "--no-fhir"], "--no-fhir does not apply to mapping-table"],
  ])("rejects %j", async (args, message) => {
    const cli = capture();
    expect(await run(args, cli.io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toContain(message);
  });

  it("reports a file it cannot write", async () => {
    const cli = capture();
    const io = {
      ...cli.io,
      writeFile: () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })),
    };
    expect(await run(["export", motu, ...fixed], io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toBe("cindermed: cannot write motu-mapping-0.1.0.zip (EACCES)\n");
  });
});

describe("cindermed mapping-table", () => {
  const metastra = `${examples}metastra/project.json`;
  const sheetsOf = async (name: string) => {
    const project = parseProject(await exampleText(name)).project;
    if (project === undefined) throw new Error("fixture project is not valid");
    return mappingTables(project);
  };

  it("writes one XLSX workbook by default, dated --created-at", async () => {
    const cli = capture();
    const args = ["mapping-table", metastra, "--created-at", "2026-11-12T00:00:00Z"];
    expect(await run(args, cli.io)).toBe(ExitCode.OK);
    const expected = toXlsx(await sheetsOf("metastra"), { createdAt: "2026-11-12T00:00:00Z" });
    expect([...cli.written.keys()]).toEqual(["metastra-mapping-table.xlsx"]);
    expect(cli.written.get("metastra-mapping-table.xlsx")).toEqual(expected);
    expect(cli.stdout()).toBe(
      `${metastra}: wrote the mapping table to metastra-mapping-table.xlsx\n` +
        "   16 Mapping\n   17 Value maps\n    6 Roles\n   11 Columns\n",
    );
  });

  it("writes one CSV file per sheet into a folder, with the chosen delimiter", async () => {
    const cli = capture();
    const args = [
      "mapping-table",
      metastra,
      "--format",
      "csv",
      "--delimiter",
      ";",
      "--out",
      "table/",
    ];
    expect(await run(args, cli.io)).toBe(ExitCode.OK);
    expect([...cli.written.keys()]).toEqual([
      "table/mapping.csv",
      "table/value-maps.csv",
      "table/roles.csv",
      "table/columns.csv",
    ]);
    const [mapping] = await sheetsOf("metastra");
    if (mapping === undefined) throw new Error("no sheet");
    expect(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(cli.written.get("table/mapping.csv")),
    ).toBe(toCsv(mapping, { delimiter: ";" }));
  });

  it("uses the clock and the default folder for csv", async () => {
    const cli = capture();
    expect(await run(["mapping-table", metastra, "--format", "csv"], cli.io)).toBe(ExitCode.OK);
    expect([...cli.written.keys()][0]).toBe("metastra-mapping-table/mapping.csv");
    const xlsx = capture();
    await run(["mapping-table", metastra], xlsx.io);
    const core = unzipSync(xlsx.written.get("metastra-mapping-table.xlsx") ?? new Uint8Array())[
      "docProps/core.xml"
    ];
    expect(new TextDecoder().decode(core)).toContain("2026-11-12T08:30:15Z");
  });

  it("writes the table of a project with integrity errors and lists them; not of an invalid file", async () => {
    const broken = JSON.parse(await exampleText("motu")) as { mappings: { code: string }[] };
    const [first, second] = broken.mappings;
    if (first === undefined || second === undefined) throw new Error("fixture changed");
    second.code = first.code;
    const cli = capture({ "broken.json": JSON.stringify(broken) });
    expect(await run(["mapping-table", "broken.json"], cli.io)).toBe(ExitCode.OK);
    expect(cli.written.size).toBe(1);
    expect(cli.stdout()).toContain(
      "  note: written although the project has 1 finding:\n  error DUPLICATE_ROW_CODE",
    );
    const invalid = capture({ "bad.json": "{}" });
    expect(await run(["mapping-table", "bad.json"], invalid.io)).toBe(ExitCode.INVALID);
    expect(invalid.written.size).toBe(0);
  });

  it("writes the table of a project with dangling references and lists the findings", async () => {
    const broken = JSON.parse(await exampleText("motu")) as {
      mappings: { code: string; columnId?: string; instanceId: string }[];
    };
    const [first, second, third] = broken.mappings;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("fixture changed");
    first.columnId = "col_ghost";
    second.instanceId = "ins_ghost";
    third.code = first.code;
    const cli = capture({ "broken.json": JSON.stringify(broken) });
    expect(await run(["mapping-table", "broken.json", "--format", "csv"], cli.io)).toBe(
      ExitCode.OK,
    );
    const csv = new TextDecoder().decode(cli.written.get("motu-mapping-table/mapping.csv"));
    expect(csv).toContain("unknown column col_ghost");
    expect(csv).toContain("unknown role ins_ghost");
    expect(cli.stdout()).toContain("DANGLING_REFERENCE");
    expect(cli.stdout()).toContain("DUPLICATE_ROW_CODE");
  });

  it.each([
    [
      ["mapping-table", "p.json", "--format", "json"],
      "mapping-table writes xlsx or csv, not 'json'",
    ],
    [["mapping-table", "p.json", "--delimiter", ";"], "--delimiter only applies to --format csv"],
    [
      ["mapping-table", "p.json", "--format", "csv", "--delimiter", ";;"],
      "--delimiter must be one character",
    ],
    [
      ["mapping-table", "p.json", "--package-version", "1.0.0"],
      "--package-version does not apply to mapping-table",
    ],
    [["export", "p.json", "--delimiter", ";"], "--delimiter does not apply to export"],
    [["validate", "p.json", "--format", "csv"], "unknown format 'csv'"],
  ])("rejects %j", async (args, message) => {
    const cli = capture();
    expect(await run(args, cli.io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toContain(message);
  });
});

describe("cindermed init", () => {
  const metastraCsv = `${examples}metastra/test-data/sample-row.csv`;
  const required = ["--fhir-version", "4.0.1", "--canonical-base", "https://cindermed.org/fhir/m"];
  const written = (cli: Captured, path: string): unknown => {
    const data = cli.written.get(path);
    if (data === undefined) throw new Error(`${path} not written`);
    return JSON.parse(new TextDecoder().decode(data));
  };

  it("writes the Metastra columns, with the fixture's names in order, all string", async () => {
    const cli = capture();
    expect(await run(["init", metastraCsv, ...required, "--out", "m.json"], cli.io)).toBe(
      ExitCode.OK,
    );
    expect(cli.stdout()).toBe(
      `${metastraCsv}: wrote m.json: table sample-row, 11 columns, all string\n`,
    );
    const project = written(cli, "m.json") as {
      sources: { columns: { id: string; name: string; dataType: string }[] }[];
    };
    const fixture = JSON.parse(await exampleText("metastra")) as typeof project;
    expect(project.sources[0]?.columns.map((c) => c.name)).toEqual(
      fixture.sources[0]?.columns.map((c) => c.name),
    );
    expect(project.sources[0]?.columns.map((c) => c.id)).toEqual(
      project.sources[0]?.columns.map((c) => `col_${c.name}`),
    );
    expect(new Set(project.sources[0]?.columns.map((c) => c.dataType))).toEqual(
      new Set(["string"]),
    );
    expect(parseProject(JSON.stringify(project)).results).toEqual([]);
    expect([...cli.written.keys()]).toEqual(["m.json"]);
  });

  it("reads a windows-1252 file with ';' and a title line", async () => {
    const latin = Uint8Array.from([
      ...new TextEncoder().encode("Export\nid;Et"),
      0xe0, // à in windows-1252
      ...new TextEncoder().encode(";Costo "),
      0x80, // € in windows-1252
      ...new TextEncoder().encode("\nX1;40;3\n"),
    ]);
    const args = ["init", "v.csv", ...required, "--delimiter", ";", "--header-row", "2"];
    const cli = capture({ "v.csv": latin });
    expect(await run([...args, "--encoding", "windows-1252"], cli.io)).toBe(ExitCode.OK);
    const project = written(cli, "v.project.json") as {
      sources: { columns: { name: string }[] }[];
    };
    expect(project.sources[0]?.columns.map((c) => c.name)).toEqual(["id", "Età", "Costo €"]);

    const utf8 = capture({ "v.csv": latin });
    expect(await run(args, utf8.io)).toBe(ExitCode.INVALID);
    expect(utf8.stdout()).toContain("give the file's encoding with --encoding");
    expect(utf8.written.size).toBe(0);
  });

  it("refuses empty or duplicate headers and writes nothing", async () => {
    const cli = capture({ "bad.csv": "id,,age,id\n1,2,3,4\n" });
    expect(await run(["init", "bad.csv", ...required], cli.io)).toBe(ExitCode.INVALID);
    expect(cli.stdout()).toBe(
      "bad.csv: no project written, 2 errors\n" +
        "  error: column 2 has an empty header\n" +
        "  error: columns 1 and 4 have the same header 'id'\n",
    );
    expect(cli.written.size).toBe(0);
  });

  it("needs a FHIR version and a canonical base, and checks the reading options", async () => {
    const cases: [string[], string][] = [
      [["--canonical-base", "https://x.org/f"], "init needs --fhir-version 4.0.1 or 5.0.0"],
      [["--fhir-version", "4.0.1"], "init needs --canonical-base <url>"],
      [
        [...required, "--encoding", "latin9"],
        "--encoding must be utf-8, utf-8-bom, windows-1252, iso-8859-1, not 'latin9'",
      ],
      [[...required, "--header-row", "0"], "--header-row must be a whole number from 1, not '0'"],
      [[...required, "--delimiter", "ab"], "--delimiter must be one character"],
      [[...required, "--format", "json"], "--format does not apply to init"],
    ];
    for (const [options, message] of cases) {
      const cli = capture({ "a.csv": "a\n" });
      expect(await run(["init", "a.csv", ...options], cli.io)).toBe(ExitCode.USAGE);
      expect(cli.stderr()).toContain(message);
    }
    const none = capture();
    expect(await run(["init"], none.io)).toBe(ExitCode.USAGE);
    expect(none.stderr()).toContain("init needs a data file");
  });

  it("never overwrites a file", async () => {
    const cli = capture({ "a.csv": "a\n", "a.project.json": "{}" });
    expect(await run(["init", "a.csv", ...required], cli.io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toBe(
      "cindermed: a.project.json already exists: remove it or choose another --out\n",
    );
    expect(cli.written.size).toBe(0);
  });

  it("--infer writes a type report with counts and no cell values; the project stays string", async () => {
    const values = ["MTS-0003", "Elevated", "12/03/2024", "11,25", "4711", "Sì"];
    const csv =
      "patient_id,note,visit,hb,code,ok\n" +
      `${values[0] ?? ""},${values[1] ?? ""},${values[2] ?? ""},"${values[3] ?? ""}",${values[4] ?? ""},yes\n` +
      `MTS-0042,,05/07/1956,"9,5",815,${values[5] ?? ""}\n`;
    const cli = capture({ "d.csv": csv });
    expect(await run(["init", "d.csv", ...required, "--infer"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(
      "d.csv: wrote d.project.json: table d, 6 columns, all string\n" +
        "  type report d.project.types.json: 2 rows read; suggested types (the project is unchanged):\n" +
        "    patient_id: string (0 empty cells)\n" +
        "    note: string (1 empty cell)\n" +
        "    visit: date dd/MM/yyyy (0 empty cells)\n" +
        "    hb: decimal separator ',' (0 empty cells)\n" +
        "    code: integer (0 empty cells)\n" +
        "    ok: string (0 empty cells)\n",
    );
    const report = written(cli, "d.project.types.json") as {
      rowsRead: number;
      columns: { name: string; candidates: { dataType: string; cellsNotConverting: number }[] }[];
    };
    expect(report.rowsRead).toBe(2);
    const ok = report.columns.find((c) => c.name === "ok");
    expect(ok?.candidates.find((c) => c.dataType === "boolean")?.cellsNotConverting).toBe(1);
    const text = [...cli.written.values()].map((b) => new TextDecoder().decode(b)).join("\n");
    for (const value of [...values, "MTS-0042", "05/07/1956", "9,5", "815"])
      expect(text).not.toContain(value);
    expect(cli.stdout()).not.toContain("MTS-");
    const project = written(cli, "d.project.json") as {
      sources: { columns: { dataType: string; allowedValues?: unknown }[] }[];
    };
    expect(project.sources[0]?.columns.every((c) => c.dataType === "string")).toBe(true);
    expect(project.sources[0]?.columns.some((c) => c.allowedValues !== undefined)).toBe(false);
  });
});

describe("cindermed fhir-index", () => {
  const metastra = `${examples}metastra/project.json`;
  const fakeIndex = (files: [string, string][]) =>
    ({
      index: {
        manifest: { packages: [{ id: "hl7.fhir.r4.core", version: "4.0.1" }] },
        manifestText: '{"formatVersion":"1.1.0"}',
        files: new Map(files),
      },
      definitions: {},
      issues: [],
    }) as unknown as Awaited<ReturnType<CliIo["loadDefinitions"]>>;

  it("writes the index of the project's FHIR version into a folder", async () => {
    const cli = capture();
    const calls: unknown[] = [];
    const io: CliIo = {
      ...cli.io,
      loadDefinitions: (...args) => {
        calls.push(args);
        return Promise.resolve(fakeIndex([["types/Patient.json", '{"type":"Patient"}']]));
      },
    };
    expect(await run(["fhir-index", metastra, "--out", "web/.fhir-index/", "--offline"], io)).toBe(
      ExitCode.OK,
    );
    expect(calls).toEqual([["4.0.1", [], { offline: true }]]);
    expect([...cli.written.keys()]).toEqual([
      "web/.fhir-index/index.json",
      "web/.fhir-index/types/Patient.json",
    ]);
    expect(cli.stdout()).toBe(
      `${metastra}: wrote the FHIR 4.0.1 definition index to web/.fhir-index (1 document; hl7.fhir.r4.core#4.0.1)\n`,
    );
  });

  it("refuses a file name that would leave the folder", async () => {
    const cli = capture();
    const io: CliIo = {
      ...cli.io,
      loadDefinitions: () => Promise.resolve(fakeIndex([["../escape.json", "{}"]])),
    };
    expect(await run(["fhir-index", metastra, "--out", "idx"], io)).toBe(ExitCode.USAGE);
    expect(cli.stderr()).toContain("cannot be written safely: ../escape.json");
    expect(cli.written.size).toBe(0);
  });

  it("needs --out and a valid project", async () => {
    const none = capture();
    expect(await run(["fhir-index", metastra], none.io)).toBe(ExitCode.USAGE);
    expect(none.stderr()).toContain("fhir-index needs --out <folder>");
    const broken = capture({ "b.json": "{}" });
    expect(await run(["fhir-index", "b.json", "--out", "idx"], broken.io)).toBe(ExitCode.INVALID);
    expect(broken.stdout()).toContain("b.json: no index written");
    expect(broken.written.size).toBe(0);
  });
});
