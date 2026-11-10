import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import commitlintConfig from "../commitlint.config.js";

const repoRoot = resolve(import.meta.dirname, "..");
const github = join(repoRoot, ".github");
const read = (path: string): string => readFileSync(join(github, path), "utf8");

interface IssueForm {
  name: string;
  description: string;
  labels?: string[];
  body: { type: string; id?: string }[];
}

describe("issue forms", () => {
  const forms = readdirSync(join(github, "ISSUE_TEMPLATE")).filter(
    (file) => file.endsWith(".yml") && file !== "config.yml",
  );

  it("include the feature, chore and bug forms", () => {
    expect(forms.sort()).toEqual(["bug.yml", "chore.yml", "feature.yml"]);
  });

  it.each(forms)("%s is a valid issue form with unique field ids", (file) => {
    const form = parse(read(join("ISSUE_TEMPLATE", file))) as IssueForm;
    expect(form.name).toBeTruthy();
    expect(form.description).toBeTruthy();
    expect(form.body.length).toBeGreaterThan(0);
    const ids = form.body.flatMap((field) => (field.id ? [field.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("disables blank issues", () => {
    expect(parse(read("ISSUE_TEMPLATE/config.yml"))).toEqual({ blank_issues_enabled: false });
  });
});

describe("pull request template", () => {
  const template = read("pull_request_template.md");

  it.each([
    "## Features and module",
    "## What changes",
    "## How to check",
    "## Screenshots",
    "## Changeset",
    "## ADR",
  ])("has the section %s", (heading) => {
    expect(template).toContain(heading);
  });

  it("asks for the issue link", () => {
    expect(template).toMatch(/^Closes #/m);
  });
});

describe("CONTRIBUTING", () => {
  it("lists exactly the commit scopes enforced by commitlint", () => {
    const line = read("CONTRIBUTING.md")
      .split("\n")
      .find((text) => text.startsWith("- Scopes:"));
    const documented = [...(line ?? "").matchAll(/`([a-z-]+)`/g)].map((match) => match[1]);
    const enforced = commitlintConfig.rules["scope-enum"][2];
    expect(documented).toEqual(enforced);
  });
});

describe("FUNDING.yml", () => {
  it("points to the CinderMed organization", () => {
    expect(parse(read("FUNDING.yml"))).toEqual({ github: ["CinderMed"] });
  });
});
