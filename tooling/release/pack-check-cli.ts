// CI entry point (#199): packs every publishable package with `pnpm pack` into .tmp/pack and checks
// each tarball. Needs the packages built from a clean checkout first (`pnpm -r build`), so `dist/`
// holds no stale files. Publishes nothing.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PUBLISHABLE, checkPacked } from "./pack-check.ts";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, ".tmp", "pack");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const rootLicense = readFileSync(join(root, "LICENSE"), "utf8");

const tar = (args: string[]) => execFileSync("tar", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const problems: string[] = [];
for (const folder of PUBLISHABLE) {
  const before = new Set(execFileSync("ls", [out], { encoding: "utf8" }).split("\n"));
  execFileSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: join(root, folder),
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = execFileSync("ls", [out], { encoding: "utf8" })
    .split("\n")
    .find((file) => file.endsWith(".tgz") && !before.has(file));
  if (tarball === undefined) {
    problems.push(`${folder}: pnpm pack wrote no tarball`);
    continue;
  }
  const file = join(out, tarball);
  const entries = tar(["-tzf", file])
    .split("\n")
    .filter((e) => e !== "" && !e.endsWith("/"))
    .map((e) => e.replace(/^package\//, ""));
  const read = (entry: string) => tar(["-xzOf", file, `package/${entry}`]);
  const manifest = JSON.parse(read("package.json")) as Record<string, unknown>;
  const license = entries.includes("LICENSE") ? read("LICENSE") : undefined;
  const found = checkPacked({ entries, manifest, license }, rootLicense);
  problems.push(...found);
  console.log(
    `pack: ${folder} → ${tarball}, ${String(entries.length)} files${found.length > 0 ? `, ${String(found.length)} problems` : ", ok"}`,
  );
}
for (const problem of problems) console.error(`pack: ${problem}`);
if (problems.length > 0) process.exitCode = 1;
