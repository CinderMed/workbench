import { describe, expect, it } from "vitest";
import { checkChangeset, isChangeset, isPackageCode } from "./changeset-check.ts";

const base = { labels: [] as string[], headRef: "feature/d3-path-picker" };

describe("isPackageCode", () => {
  it.each([
    ["packages/fml/src/printer.ts", true],
    ["packages/model/package.json", true],
    ["apps/api/src/server.ts", true],
    ["apps/web/src/App.tsx", true],
    ["packages/fml/src/printer.test.ts", false],
    ["apps/web/src/App.test.tsx", false],
    ["packages/fml/CHANGELOG.md", false],
    ["packages/fml/README.md", false],
    ["apps/docs/src/content/docs/index.md", false],
    ["docs/adr/0003-module-0-tooling.md", false],
    ["tooling/boundaries.test.ts", false],
    [".github/workflows/ci.yml", false],
  ])("%s → %s", (file, expected) => {
    expect(isPackageCode(file)).toBe(expected);
  });
});

describe("isChangeset", () => {
  it("accepts changeset files and rejects the README and config", () => {
    expect(isChangeset(".changeset/brave-lions-sing.md")).toBe(true);
    expect(isChangeset(".changeset/README.md")).toBe(false);
    expect(isChangeset(".changeset/config.json")).toBe(false);
  });
});

describe("checkChangeset", () => {
  it("fails when package code changes without a changeset", () => {
    const result = checkChangeset({ ...base, changedFiles: ["packages/fml/src/printer.ts"] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("packages/fml/src/printer.ts");
    expect(result.reason).toContain("pnpm changeset");
  });

  it("passes when a changeset is added", () => {
    expect(
      checkChangeset({
        ...base,
        changedFiles: ["packages/fml/src/printer.ts", ".changeset/brave-lions-sing.md"],
      }).ok,
    ).toBe(true);
  });

  it("passes with the no-changeset label", () => {
    expect(
      checkChangeset({
        ...base,
        labels: ["chore", "no-changeset"],
        changedFiles: ["packages/fml/src/printer.ts"],
      }).ok,
    ).toBe(true);
  });

  it("passes when only tests, docs or tooling change", () => {
    expect(
      checkChangeset({
        ...base,
        changedFiles: ["packages/fml/src/printer.test.ts", "docs/adr/0004-x.md", "tooling/a.ts"],
      }),
    ).toEqual({ ok: true, reason: "No package code changed." });
  });

  it("passes on the Version Packages pull request", () => {
    expect(
      checkChangeset({
        labels: [],
        headRef: "changeset-release/main",
        changedFiles: ["apps/api/package.json"],
      }).ok,
    ).toBe(true);
  });

  it("lists at most five files in the message", () => {
    const changedFiles = Array.from({ length: 7 }, (_, i) => `packages/fml/src/f${String(i)}.ts`);
    const { reason } = checkChangeset({ ...base, changedFiles });
    expect(reason).toContain("f4.ts, …");
    expect(reason).not.toContain("f5.ts");
  });
});
