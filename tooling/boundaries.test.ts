import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cruise } from "dependency-cruiser";
import { afterAll, describe, expect, it } from "vitest";
import config from "../.dependency-cruiser.cjs";

const repoRoot = resolve(import.meta.dirname, "..");
// Tests write only under .tmp/ (CLAUDE.md).
const workDir = join(repoRoot, ".tmp", "boundaries");

function writeTree(files: Record<string, string>): string[] {
  rmSync(workDir, { recursive: true, force: true });
  const roots = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    const target = join(workDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    roots.add(path.split("/")[0] ?? path);
  }
  return [...roots];
}

/** Writes a fake workspace under .tmp/ and returns the names of the rules it violates. */
async function cruiseRules(files: Record<string, string>): Promise<string[]> {
  const roots = writeTree(files).filter((root) => root !== "node_modules");
  const result = await cruise(roots, {
    baseDir: workDir,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
    tsPreCompilationDeps: true,
  });
  if (typeof result.output === "string") throw new Error("unexpected string output");
  return result.output.summary.violations.map((violation) => violation.rule.name).sort();
}

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("package boundaries (ADR-0001)", () => {
  it("accepts a domain package that imports another domain package", async () => {
    expect(
      await cruiseRules({
        "packages/model/src/index.ts": "export const a = 1;\n",
        "packages/fml/src/index.ts":
          'import { a } from "../../model/src/index";\nexport const b = a;\n',
      }),
    ).toEqual([]);
  });

  it("rejects file-system and network imports in a domain package", async () => {
    expect(
      await cruiseRules({
        "packages/fml/src/index.ts":
          'import { readFileSync } from "node:fs";\nimport http from "node:http";\nexport const x = [readFileSync, http];\n',
      }),
    ).toEqual(["domain-no-node-io", "domain-no-node-io"]);
  });

  it("rejects database and HTTP libraries in a domain package", async () => {
    expect(
      await cruiseRules({
        "node_modules/pg/package.json": '{ "name": "pg", "main": "index.js" }\n',
        "node_modules/pg/index.js": "module.exports = {};\n",
        "packages/model/src/index.ts": 'import pg from "pg";\nexport const x = pg;\n',
      }),
    ).toEqual(["domain-no-io-libraries"]);
  });

  it("allows I/O in apps", async () => {
    expect(
      await cruiseRules({
        "apps/api/src/index.ts":
          'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
      }),
    ).toEqual([]);
  });

  it("rejects a package that imports an app", async () => {
    expect(
      await cruiseRules({
        "apps/api/src/index.ts": "export const server = 1;\n",
        "packages/export/src/index.ts":
          'import { server } from "../../../apps/api/src/index";\nexport const x = server;\n',
      }),
    ).toEqual(["packages-not-to-apps"]);
  });

  it("rejects the web app importing the api app", async () => {
    expect(
      await cruiseRules({
        "apps/api/src/index.ts": "export const server = 1;\n",
        "apps/web/src/index.ts":
          'import { server } from "../../api/src/index";\nexport const x = server;\n',
      }),
    ).toEqual(["web-not-to-api"]);
  });
});
