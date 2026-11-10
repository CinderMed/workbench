// CI entry point, run by release.yml when no changesets are pending (i.e. after the
// "Version Packages" PR is merged, and on every other push to main, where it does nothing).
// Creates the vX.Y.Z tag and the GitHub Release once per product version.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { productTag, releaseNotes, type BumpedPackage } from "./product-release.ts";

const PRODUCT_PACKAGE = "apps/api/package.json";

const run = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: "utf8" }).trim();

function versionAt(revision: string, path: string): string | undefined {
  try {
    return (JSON.parse(run("git", ["show", `${revision}:${path}`])) as { version?: string })
      .version;
  } catch {
    return undefined;
  }
}

function output(name: string, value: string): void {
  const file = process.env["GITHUB_OUTPUT"];
  if (file) appendFileSync(file, `${name}=${value}\n`);
}

const { version } = JSON.parse(readFileSync(PRODUCT_PACKAGE, "utf8")) as { version: string };
const tag = productTag(version);
output("released", "false");

if (tag === undefined) {
  console.log(`Product version ${version}: nothing released yet.`);
} else if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "") {
  console.log(`${tag} already exists.`);
} else {
  const packages: BumpedPackage[] = ["apps", "packages"].flatMap((group) =>
    readdirSync(group)
      .map((dir) => join(group, dir))
      .filter((dir) => existsSync(join(dir, "package.json")))
      .map((dir) => {
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          name: string;
          version: string;
        };
        const changelogPath = join(dir, "CHANGELOG.md");
        return {
          name: manifest.name,
          version: manifest.version,
          previousVersion: versionAt("HEAD~1", join(dir, "package.json")),
          changelog: existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : undefined,
        };
      }),
  );
  const notesFile = join(".tmp", "release-notes.md");
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(notesFile, releaseNotes(packages));
  const prerelease = version.includes("-") ? ["--prerelease"] : [];
  run("gh", [
    "release",
    "create",
    tag,
    "--target",
    run("git", ["rev-parse", "HEAD"]),
    "--title",
    `CinderMed ${tag}`,
    "--notes-file",
    notesFile,
    ...prerelease,
  ]);
  console.log(`Released ${tag}.`);
  output("released", "true");
  output("version", version);
  output("tag", tag);
}
