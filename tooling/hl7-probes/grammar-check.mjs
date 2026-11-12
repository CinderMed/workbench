// Grammar side of the HL7 probe (#134): the official mapping.g4 check (parseFml, the parser behind
// checkGrammar) on every probe map. One tab-separated line per map. Needs @cindermed/fml built.
// Usage: node tooling/hl7-probes/grammar-check.mjs
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const { parseFml } = await import(resolve(root, "packages/fml/dist/grammar.js"));
const maps = resolve(import.meta.dirname, "maps");

console.log("map\tgrammar");
for (const file of readdirSync(maps).sort()) {
  const errors = parseFml(readFileSync(resolve(maps, file), "utf8"));
  const result = errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(" | ");
  console.log(`${file.replace(/\.map$/, "")}\t${errors.length === 0 ? "ok" : result}`);
}
