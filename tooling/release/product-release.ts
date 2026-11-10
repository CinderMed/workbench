/**
 * Product release notes (specification, "Versions and releases"): after the "Version Packages"
 * pull request is merged, the workbench version (the fixed api + web group) gets a vX.Y.Z tag and
 * a GitHub Release whose notes are the changelog sections of every package bumped in that commit.
 */

export interface BumpedPackage {
  name: string;
  version: string;
  previousVersion: string | undefined;
  changelog: string | undefined;
}

/** The body of the "## <version>" section of a Changesets CHANGELOG.md, without its heading. */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body === "" ? undefined : body;
}

/** Release notes: one "## <package> <version>" block per package bumped in the release commit. */
export function releaseNotes(packages: readonly BumpedPackage[]): string {
  const blocks = packages
    .filter((pkg) => pkg.previousVersion !== pkg.version)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((pkg) => {
      const section = pkg.changelog ? changelogSection(pkg.changelog, pkg.version) : undefined;
      return section ? [`## ${pkg.name} ${pkg.version}\n\n${section}`] : [];
    });
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "No changelog entries.\n";
}

/** The tag for a product version, or undefined when nothing has been released yet. */
export function productTag(version: string): string | undefined {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid product version "${version}"`);
  }
  return version === "0.0.0" ? undefined : `v${version}`;
}
