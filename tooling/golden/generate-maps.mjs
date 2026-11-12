// Replaces the verified maps of a COPY of fixtures/fml-examples with the maps the generator
// produces from each project (FML text and StructureMap JSON), so the golden suite can check that
// the generated maps give the committed Bundles. Never run it on fixtures/ itself.
// Usage: node tooling/golden/generate-maps.mjs <copy of fixtures/fml-examples>  (packages built)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const target = resolve(process.argv[2] ?? "");
if (target.startsWith(join(root, "fixtures"))) throw new Error("refusing to write into fixtures/");
const dist = join(root, "packages/fml/dist/index.js");
if (!existsSync(dist))
  throw new Error("build the packages first: pnpm --filter './packages/*' build");
const fml = await import(dist);

for (const folder of readdirSync(target, { withFileTypes: true })) {
  const projectFile = join(target, folder.name, "project.json");
  if (!folder.isDirectory() || !existsSync(projectFile)) continue;
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  for (const source of project.sources) {
    const planned = fml.planTable(project, source.id);
    if (!planned.ok)
      throw new Error(`${folder.name}/${source.name}: ${JSON.stringify(planned.results)}`);
    const map = fml.generateMap(project, planned.value);
    if (!map.ok) throw new Error(`${folder.name}/${source.name}: ${JSON.stringify(map.results)}`);
    const name = planned.value.name;
    writeFileSync(join(target, folder.name, `${name}.map`), fml.printMap(map.value));
    const json = fml.toStructureMap(map.value, { fhirRelease: "R4" });
    writeFileSync(
      join(target, folder.name, `StructureMap-${name}.json`),
      `${JSON.stringify(json, null, 2)}\n`,
    );
    console.log(`generated ${folder.name}/${name}.map and StructureMap-${name}.json`);
  }
}
