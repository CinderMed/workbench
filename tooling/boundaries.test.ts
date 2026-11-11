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

describe("FML grammar check stays in the backend (ADR-0008)", () => {
  const grammarSources = {
    "packages/fml/src/grammar/generated/mappingParser.ts": "export const parser = 1;\n",
    "packages/fml/src/grammar-check.ts":
      'import { parser } from "./grammar/generated/mappingParser";\nexport const parseFml = parser;\n',
    "packages/fml/src/grammar.ts":
      'import { parseFml } from "./grammar-check";\nexport const check = parseFml;\n',
    "packages/fml/src/fml-print.ts": "export const printMap = 1;\n",
  };

  it("rejects the web app importing the @cindermed/fml/grammar subpath", async () => {
    expect(
      await cruiseRules({
        "apps/web/src/index.ts":
          'import { parseFml } from "@cindermed/fml/grammar";\nexport const x = parseFml;\n',
      }),
    ).toEqual(["not-to-unresolvable", "web-no-fml-grammar"]);
  });

  it("rejects the web app reaching the grammar check sources or antlr4ng", async () => {
    expect(
      await cruiseRules({
        ...grammarSources,
        "node_modules/antlr4ng/index.js": "export const Parser = 1;\n",
        "node_modules/antlr4ng/package.json": '{ "name": "antlr4ng", "main": "index.js" }\n',
        "apps/web/src/index.ts":
          'import { check } from "../../../packages/fml/src/grammar";\nimport { Parser } from "antlr4ng";\nexport const x = [check, Parser];\n',
      }),
    ).toEqual(["web-no-fml-grammar", "web-no-fml-grammar"]);
  });

  it("accepts the web app importing the package root", async () => {
    expect(
      await cruiseRules({
        ...grammarSources,
        "packages/fml/src/index.ts": 'export { printMap } from "./fml-print";\n',
        "apps/web/src/index.ts":
          'import { printMap } from "../../../packages/fml/src/index";\nexport const x = printMap;\n',
      }),
    ).toEqual([]);
  });

  it("rejects a package root that reaches the grammar check, even indirectly", async () => {
    // One violation per grammar module reached: grammar.ts, grammar-check.ts and the parser.
    const rules = await cruiseRules({
      ...grammarSources,
      "packages/fml/src/helper.ts": 'export { check } from "./grammar";\n',
      "packages/fml/src/index.ts": 'export { check } from "./helper";\n',
    });
    expect(new Set(rules)).toEqual(new Set(["fml-root-without-grammar"]));
    expect(rules).toHaveLength(3);
  });
});
