// `pnpm codegen`: regenerates packages/model/src/generated from packages/model/src/schemas.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TARGETS, generateTypes } from "./model-types.ts";

const model = fileURLToPath(new URL("../../packages/model/src/", import.meta.url));
const outputDir = `${model}generated/`;
mkdirSync(outputDir, { recursive: true });

for (const target of TARGETS) {
  const schema = JSON.parse(
    readFileSync(`${model}schemas/${target.schemaFile}`, "utf8"),
  ) as Parameters<typeof generateTypes>[1];
  const output = `${outputDir}${target.outputFile}`;
  writeFileSync(output, await generateTypes(target, schema, output));
  console.log(`generated ${target.outputFile} from ${target.schemaFile}`);
}
