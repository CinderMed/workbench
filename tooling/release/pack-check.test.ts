import { describe, expect, it } from "vitest";
import { checkPacked, type PackedPackage } from "./pack-check.ts";

const LICENSE = "Apache License\n";
const good = (): PackedPackage => ({
  entries: [
    "package.json",
    "LICENSE",
    "README.md",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/bin.js",
  ],
  manifest: {
    name: "@cindermed/example",
    version: "1.0.0",
    private: true,
    description: "An example",
    license: "Apache-2.0",
    repository: { type: "git", url: "git+https://github.com/CinderMed/workbench.git" },
    engines: { node: ">=22.12.0" },
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    bin: { cindermed: "./dist/bin.js" },
    dependencies: { "@cindermed/model": "0.5.0", tar: "7.5.22" },
  },
  license: LICENSE,
});

describe("checkPacked (#199)", () => {
  it("accepts a private package with its metadata, dist, LICENSE and README", () => {
    expect(checkPacked(good(), LICENSE)).toEqual([]);
  });

  it("reports what npm should not receive, and what it would miss", () => {
    const packed = good();
    const problems = checkPacked(
      {
        entries: [
          "package.json",
          "dist/index.js",
          "dist/index.js.map",
          "dist/test-support/r4-index.json",
          "dist/a.test.js",
          "src/index.ts",
        ],
        manifest: {
          ...packed.manifest,
          private: false,
          repository: undefined,
          dependencies: { "@cindermed/model": "workspace:*" },
        },
        license: "MIT\n",
      },
      LICENSE,
    );
    expect(problems).toEqual([
      "@cindermed/example: not private; publishing is off until a later release (#199)",
      "@cindermed/example: package.json has no repository",
      '@cindermed/example: dependencies.@cindermed/model is "workspace:*", not a published version',
      "@cindermed/example: dist/index.d.ts is named but not in the tarball",
      "@cindermed/example: dist/bin.js is named but not in the tarball",
      "@cindermed/example: dist/index.js.map is a source map without its sources",
      "@cindermed/example: dist/test-support/r4-index.json is test code",
      "@cindermed/example: dist/a.test.js is test code",
      "@cindermed/example: src/index.ts should not be published",
      "@cindermed/example: its LICENSE differs from the repository's",
      "@cindermed/example: the tarball has no README.md",
    ]);
  });
});
