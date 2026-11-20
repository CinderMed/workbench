// Third-party dependencies are pinned to an exact version (CLAUDE.md, "Default principles");
// workspace packages use `workspace:*`. pnpm-workspace.yaml sets `saveExact` so `pnpm add` pins.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = resolve(import.meta.dirname, "..");
const manifests = [
  "package.json",
  ...["apps", "packages"].flatMap((dir) =>
    readdirSync(join(repoRoot, dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name, "package.json")),
  ),
];
const EXACT = /^\d+\.\d+\.\d+$/;
const KINDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

describe("dependencies", () => {
  it.each(manifests)("%s pins every third-party dependency exactly", (manifest) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, manifest), "utf8")) as Partial<
      Record<(typeof KINDS)[number], Record<string, string>>
    >;
    const ranged = KINDS.flatMap((kind) =>
      Object.entries(pkg[kind] ?? {})
        .filter(([, spec]) => !spec.startsWith("workspace:") && !EXACT.test(spec))
        .map(([name, spec]) => `${kind}.${name}: ${spec}`),
    );
    expect(ranged).toEqual([]);
  });

  it("makes pnpm add save exact versions", () => {
    const workspace = parse(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8")) as {
      saveExact?: boolean;
    };
    expect(workspace.saveExact).toBe(true);
  });
});
