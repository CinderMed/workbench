import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CliIo, ExitCode, USAGE, packageName, run } from "./index.js";

const examples = fileURLToPath(new URL("../../../fixtures/fml-examples/", import.meta.url));

interface Captured {
  readonly io: CliIo;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

/** Real file reads (fixtures only, never written), captured output. */
function capture(files: Readonly<Record<string, string>> = {}): Captured {
  let out = "";
  let err = "";
  return {
    io: {
      readFile: async (path) => files[path] ?? (await readFile(path, "utf8")),
      stdout: (text) => (out += text),
      stderr: (text) => (err += text),
    },
    stdout: () => out,
    stderr: () => err,
  };
}

async function exampleText(name: string): Promise<string> {
  return readFile(`${examples}${name}/project.json`, "utf8");
}

describe("cindermed validate", () => {
  it.each(["metastra", "motu"])("accepts the %s example project", async (name) => {
    const path = `${examples}${name}/project.json`;
    const cli = capture();
    expect(await run(["validate", path], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(`${path}: valid (format 1.3.0)\n`);
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

    expect(await run(["validate", "broken.json"], cli.io)).toBe(ExitCode.INVALID);
    const lines = cli.stdout().trimEnd().split("\n");
    expect(lines[0]).toBe("broken.json: 1 error");
    expect(lines[1]).toMatch(/^ {2}error DUPLICATE_ROW_CODE mapping \S+ \(code\): /);
  });

  it("reports text that is not JSON", async () => {
    const cli = capture({ "bad.json": "{" });
    expect(await run(["validate", "bad.json"], cli.io)).toBe(ExitCode.INVALID);
    expect(cli.stdout()).toContain("bad.json: 1 error\n  error INVALID_JSON project: ");
  });

  it("writes a JSON report with --format json", async () => {
    const path = `${examples}motu/project.json`;
    const cli = capture();
    expect(await run(["validate", path, "--format", "json"], cli.io)).toBe(ExitCode.OK);
    expect(JSON.parse(cli.stdout())).toEqual({
      file: path,
      valid: true,
      formatVersion: "1.3.0",
      results: [],
    });
  });

  it("notes a project read from an older minor format", async () => {
    const project = JSON.parse(await exampleText("motu")) as Record<string, unknown>;
    const cli = capture({ "old.json": JSON.stringify({ ...project, formatVersion: "1.1.0" }) });
    expect(await run(["validate", "old.json"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(
      "old.json: valid (format 1.3.0)\n  note: read as format 1.3.0 (file has 1.1.0)\n",
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

describe("cindermed usage", () => {
  it("prints the help with --help", async () => {
    const cli = capture();
    expect(await run(["--help"], cli.io)).toBe(ExitCode.OK);
    expect(cli.stdout()).toBe(USAGE);
  });

  it.each([
    [[], "missing command"],
    [["export", "p.json"], "unknown command 'export'"],
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
