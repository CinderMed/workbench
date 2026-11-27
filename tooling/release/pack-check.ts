/**
 * Checks the tarball `pnpm pack` makes of each library package and of the CLI (#199): what npm
 * would receive, while publishing stays off. Nothing is published: every package keeps
 * `"private": true` until publishing is turned on in a later release.
 */

/** The packages that would be published, by folder. */
export const PUBLISHABLE = [
  "packages/model",
  "packages/fhir-defs",
  "packages/fml",
  "packages/normalizer",
  "packages/export",
  "apps/cli",
] as const;

export interface PackedPackage {
  /** Paths inside the tarball, without the leading `package/`. */
  readonly entries: readonly string[];
  /** The package.json inside the tarball, as pnpm rewrote it. */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** The LICENSE inside the tarball, if any. */
  readonly license: string | undefined;
}

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** A path inside a test-support or __tests__ folder, at any depth. */
const TEST_FOLDER = /(?:^|\/)(?:test-support|__tests__)\//;
/** A compiled test file, such as `a.test.js`. */
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/** Paths an `exports` or `bin` field points to, without the leading `./`. */
function targets(value: unknown): string[] {
  if (typeof value === "string") return [value.replace(/^\.\//, "")];
  if (typeof value === "object" && value !== null)
    return Object.values(value).flatMap((v) => targets(v));
  return [];
}

/** The problems of one packed package; an empty list when it would publish as it should. */
export function checkPacked(packed: PackedPackage, rootLicense: string): string[] {
  const problems: string[] = [];
  const { entries, manifest } = packed;
  const name = typeof manifest["name"] === "string" ? manifest["name"] : "(no name)";

  if (manifest["private"] !== true)
    problems.push(`${name}: not private; publishing is off until a later release (#199)`);
  for (const field of ["name", "version", "description", "license", "repository", "engines"])
    if (manifest[field] === undefined) problems.push(`${name}: package.json has no ${field}`);

  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [dep, range] of Object.entries(deps))
      if (typeof range !== "string" || /^(workspace|link|file|portal):/.test(range))
        problems.push(`${name}: ${field}.${dep} is "${String(range)}", not a published version`);
  }

  const present = new Set(entries);
  for (const target of [...targets(manifest["exports"]), ...targets(manifest["bin"])])
    if (!present.has(target)) problems.push(`${name}: ${target} is named but not in the tarball`);

  for (const entry of entries) {
    const allowed =
      entry === "package.json" ||
      entry === "LICENSE" ||
      entry === "README.md" ||
      entry.startsWith("dist/");
    if (!allowed) problems.push(`${name}: ${entry} should not be published`);
    else if (entry.endsWith(".map"))
      problems.push(`${name}: ${entry} is a source map without its sources`);
    else if (TEST_FOLDER.test(entry) || TEST_FILE.test(entry))
      problems.push(`${name}: ${entry} is test code`);
  }

  if (packed.license === undefined) problems.push(`${name}: the tarball has no LICENSE`);
  else if (packed.license !== rootLicense)
    problems.push(`${name}: its LICENSE differs from the repository's`);
  if (!present.has("README.md")) problems.push(`${name}: the tarball has no README.md`);
  return problems;
}
