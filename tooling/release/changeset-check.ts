/**
 * Decides whether a pull request needs a changeset (specification, "Versions and releases").
 * A changeset is required when the code of a package or app changes, unless the PR has the
 * `no-changeset` label or is the "Version Packages" PR opened by the release workflow.
 */

export interface ChangesetCheckInput {
  changedFiles: readonly string[];
  labels: readonly string[];
  headRef: string;
}

export interface ChangesetCheckResult {
  ok: boolean;
  reason: string;
}

const NO_CHANGESET_LABEL = "no-changeset";
const RELEASE_BRANCH_PREFIX = "changeset-release/";

/** Files that count as package code: anything under packages/* or apps/* except tests and docs. */
export function isPackageCode(file: string): boolean {
  if (!/^(packages|apps)\/[^/]+\//.test(file)) return false;
  if (file.startsWith("apps/docs/")) return false;
  if (/\.test\.tsx?$/.test(file)) return false;
  if (/(^|\/)(CHANGELOG|README)\.md$/.test(file)) return false;
  return true;
}

export function isChangeset(file: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(file) && file !== ".changeset/README.md";
}

export function checkChangeset(input: ChangesetCheckInput): ChangesetCheckResult {
  if (input.headRef.startsWith(RELEASE_BRANCH_PREFIX)) {
    return { ok: true, reason: "Version Packages pull request: changesets are consumed here." };
  }
  if (input.labels.includes(NO_CHANGESET_LABEL)) {
    return { ok: true, reason: `Labelled "${NO_CHANGESET_LABEL}".` };
  }
  const code = input.changedFiles.filter(isPackageCode);
  if (code.length === 0) {
    return { ok: true, reason: "No package code changed." };
  }
  if (input.changedFiles.some(isChangeset)) {
    return { ok: true, reason: "Changeset present." };
  }
  return {
    ok: false,
    reason:
      `Package code changed (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}) ` +
      `but no changeset was added. Run "pnpm changeset", or add the "${NO_CHANGESET_LABEL}" ` +
      "label with a reason in the description.",
  };
}
