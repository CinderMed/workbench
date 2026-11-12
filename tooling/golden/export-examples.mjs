// Golden step: runs the real `cindermed export` (built CLI) on every example project and compares the
// package with fixtures/fml-examples (#76). Maps, logical models and ConceptMaps must be
// byte-identical; normalization specifications too, apart from `$schema` (the package points to its
// own schemas/, the fixtures to ../); StructureMap JSON must have the content of the HL7-compiled
// fixture. The manifest must be the committed one apart from `$schema`, `generator` and the digests
// of the files whose `$schema` differs, and every digest must match the exported bytes. The
// packages are written as folders under <out>/<example>/, and the next golden step runs them.
// Usage: node tooling/golden/export-examples.mjs <out>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const fixtures = join(root, "fixtures/fml-examples");
const out = resolve(process.argv[2] ?? "");
const cli = join(root, "apps/cli/dist/bin.js");
if (!existsSync(cli)) throw new Error("build the CLI first: pnpm --filter @cindermed/cli build");

const problems = [];
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
for (const example of readdirSync(fixtures, { withFileTypes: true })) {
  const folder = join(fixtures, example.name);
  if (!example.isDirectory() || !existsSync(join(folder, "manifest.json"))) continue;
  const committed = json(join(folder, "manifest.json"));
  const target = join(out, example.name);
  execFileSync(
    process.execPath,
    [
      cli,
      "export",
      join(folder, "project.json"),
      "--package-version",
      committed.package.version,
      "--created-at",
      committed.package.createdAt,
      "--out",
      target,
    ],
    { stdio: "inherit" },
  );

  const files = readdirSync(target).filter((f) => f.endsWith(".map") || f.endsWith(".json"));
  for (const file of files) {
    if (file === "project.json" || file === "manifest.json") continue;
    const ours = readFileSync(join(target, file));
    const theirs = join(folder, file);
    if (!existsSync(theirs)) problems.push(`${example.name}/${file}: not in the fixtures`);
    else if (file.startsWith("normalization-")) {
      const [a, b] = [JSON.parse(ours.toString("utf8")), json(theirs)];
      delete a.$schema;
      delete b.$schema;
      if (!isDeepStrictEqual(a, b))
        problems.push(`${example.name}/${file}: differs ($schema aside)`);
    } else if (file.startsWith("StructureMap-")) {
      if (!isDeepStrictEqual(JSON.parse(ours.toString("utf8")), json(theirs)))
        problems.push(`${example.name}/${file}: content differs from the HL7 compilation`);
    } else if (Buffer.compare(ours, readFileSync(theirs)) !== 0)
      problems.push(`${example.name}/${file}: differs`);
  }
  const manifest = json(join(target, "manifest.json"));
  for (const entry of manifest.files) {
    const digest = createHash("sha256")
      .update(readFileSync(join(target, entry.path)))
      .digest("hex");
    if (digest !== entry.sha256)
      problems.push(`${example.name}/manifest.json: wrong digest for ${entry.path}`);
  }
  const schemaBound = (path) => path === "project.json" || path.startsWith("normalization-");
  for (const m of [manifest, committed]) {
    delete m.$schema;
    delete m.package.generator;
    for (const entry of m.files) if (schemaBound(entry.path)) delete entry.sha256;
  }
  if (!isDeepStrictEqual(manifest, committed))
    problems.push(`${example.name}/manifest.json: differs`);
  console.log(`export: ${example.name}: ${files.length} files compared`);
}
if (problems.length > 0) {
  console.error(`export: ${problems.length} differences:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("export: every exported package matches the fixtures");
