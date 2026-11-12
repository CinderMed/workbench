import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import commitlintConfig from "../commitlint.config.js";

const repoRoot = resolve(import.meta.dirname, "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

interface Step {
  uses?: string;
  with?: Record<string, string | boolean>;
}
interface Workflow {
  jobs: Record<string, { steps?: Step[] }>;
}

const yamlFiles = [
  ...readdirSync(workflowsDir).map((file) => join(".github", "workflows", file)),
  join(".github", "actions", "setup", "action.yml"),
];
const load = (path: string): unknown => parse(readFileSync(join(repoRoot, path), "utf8"));

function usesOf(document: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "uses" && typeof value === "string") found.push(value);
        else visit(value);
      }
    }
  };
  visit(document);
  return found;
}

describe("GitHub Actions", () => {
  it("has the module 0 workflows", () => {
    expect(readdirSync(workflowsDir).sort()).toEqual([
      "changeset-check.yml",
      "ci.yml",
      "codeql.yml",
      "docs.yml",
      "nightly.yml",
      "pr-title.yml",
      "release.yml",
    ]);
  });

  it.each(yamlFiles)("%s pins every external action to a full commit SHA", (path) => {
    const external = usesOf(load(path)).filter((uses) => !uses.startsWith("./"));
    expect(external.length).toBeGreaterThan(0);
    for (const uses of external) {
      expect(uses, uses).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it("runs the required CI jobs", () => {
    const ci = load(".github/workflows/ci.yml") as Workflow;
    expect(Object.keys(ci.jobs).sort()).toEqual(
      ["build", "compose", "fixtures", "golden", "lint", "test", "typecheck"].sort(),
    );
  });

  it("runs the 1,000,000-row memory test of the normalizer nightly", () => {
    const nightly = readFileSync(join(workflowsDir, "nightly.yml"), "utf8");
    expect(nightly).toContain("schedule:");
    expect(nightly).toContain("NORMALIZER_MEMORY_ROWS: 1000000");
    expect(nightly).toContain("tooling/normalizer-memory.test.ts");
    expect(nightly).toContain("FML_GENERATIVE_COMPILE");
    expect(nightly).toContain("tooling/generative-compile.test.ts");
  });

  it("validates the FHIR resources of the examples in the golden job", () => {
    const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(ci).toContain("bash tooling/golden/validate-resources.sh");
  });

  it("checks the fixtures against the checksum file", () => {
    const ci = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(ci).toContain("sha256sum --check --strict --quiet fixtures/fml-examples.sha256");
  });

  it("keeps the generated code out of CodeQL (ADR-0004, ADR-0008)", () => {
    const codeql = load(".github/workflows/codeql.yml") as Workflow;
    const init = codeql.jobs["analyze"]?.steps?.find((s) =>
      s.uses?.startsWith("github/codeql-action/init@"),
    );
    expect(init?.with?.["config-file"]).toBe("./.github/codeql/codeql-config.yml");
    const config = load(".github/codeql/codeql-config.yml") as { "paths-ignore"?: string[] };
    expect(config["paths-ignore"]).toEqual([
      "packages/model/src/generated",
      "packages/fml/src/grammar/generated",
    ]);
  });

  it("accepts in PR titles exactly the scopes enforced by commitlint", () => {
    const prTitle = load(".github/workflows/pr-title.yml") as Workflow;
    const step = prTitle.jobs["conventional-commits"]?.steps?.find((s) =>
      s.uses?.startsWith("amannn/action-semantic-pull-request@"),
    );
    const scopes = String(step?.with?.["scopes"] ?? "")
      .split("\n")
      .filter(Boolean);
    expect(scopes).toEqual(commitlintConfig.rules["scope-enum"][2]);
  });
});
