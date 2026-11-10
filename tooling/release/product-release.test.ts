import { describe, expect, it } from "vitest";
import { changelogSection, productTag, releaseNotes } from "./product-release.ts";

const apiChangelog = `# @cindermed/api

## 0.1.0

### Minor Changes

- 1a2b3c4: Add project file validation.

### Patch Changes

- 5d6e7f8: Fix the health check.

## 0.0.1

### Patch Changes

- 9a8b7c6: First release.
`;

describe("changelogSection", () => {
  it("returns the body of the requested version only", () => {
    expect(changelogSection(apiChangelog, "0.1.0")).toBe(
      "### Minor Changes\n\n- 1a2b3c4: Add project file validation.\n\n### Patch Changes\n\n- 5d6e7f8: Fix the health check.",
    );
  });

  it("reads the last section up to the end of the file", () => {
    expect(changelogSection(apiChangelog, "0.0.1")).toBe(
      "### Patch Changes\n\n- 9a8b7c6: First release.",
    );
  });

  it("returns undefined for a missing or empty version", () => {
    expect(changelogSection(apiChangelog, "9.9.9")).toBeUndefined();
    expect(changelogSection("# x\n\n## 1.0.0\n\n## 0.9.0\n", "1.0.0")).toBeUndefined();
  });
});

describe("releaseNotes", () => {
  it("includes only the packages bumped in the release commit, sorted by name", () => {
    const notes = releaseNotes([
      {
        name: "@cindermed/web",
        version: "0.1.0",
        previousVersion: "0.0.1",
        changelog: "## 0.1.0\n\n- web change\n",
      },
      {
        name: "@cindermed/api",
        version: "0.1.0",
        previousVersion: "0.0.1",
        changelog: apiChangelog,
      },
      {
        name: "@cindermed/fml",
        version: "0.0.3",
        previousVersion: "0.0.3",
        changelog: "## 0.0.3\n\n- old\n",
      },
    ]);
    expect(notes.indexOf("## @cindermed/api 0.1.0")).toBeLessThan(
      notes.indexOf("## @cindermed/web 0.1.0"),
    );
    expect(notes).toContain("- 1a2b3c4: Add project file validation.");
    expect(notes).toContain("- web change");
    expect(notes).not.toContain("@cindermed/fml");
  });

  it("treats a package without a previous version as bumped", () => {
    expect(
      releaseNotes([
        {
          name: "@cindermed/web",
          version: "0.0.1",
          previousVersion: undefined,
          changelog: "## 0.0.1\n\n- first\n",
        },
      ]),
    ).toBe("## @cindermed/web 0.0.1\n\n- first\n");
  });

  it("says so when no bumped package has changelog entries", () => {
    expect(
      releaseNotes([
        { name: "a", version: "1.0.0", previousVersion: "0.9.0", changelog: undefined },
      ]),
    ).toBe("No changelog entries.\n");
  });
});

describe("productTag", () => {
  it("is vX.Y.Z for a released version", () => {
    expect(productTag("0.0.1")).toBe("v0.0.1");
    expect(productTag("1.0.0-rc.1")).toBe("v1.0.0-rc.1");
  });

  it("is undefined before the first release", () => {
    expect(productTag("0.0.0")).toBeUndefined();
  });

  it("rejects a malformed version", () => {
    expect(() => productTag("v1")).toThrow('invalid product version "v1"');
  });
});
