// `pnpm codegen`: regenerates packages/fml/src/grammar/generated from packages/fml/grammar/mapping.g4.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OUTPUT_DIR, generateGrammarParser } from "./fml-grammar.ts";

const outputDir = fileURLToPath(new URL(`../../${OUTPUT_DIR}/`, import.meta.url));
mkdirSync(outputDir, { recursive: true });
for (const [file, source] of generateGrammarParser()) {
  writeFileSync(`${outputDir}${file}`, source);
  console.log(`generated ${file} from mapping.g4`);
}
