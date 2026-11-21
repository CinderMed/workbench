// Compares the StructureMap the HL7 engine compiled with the one our builder wrote (ADR-0007).
// R4: equal apart from `status`, which the compiler does not write.
// R5 (#78): validator 7.0.5 writes an invalid R5 StructureMap (111 validation errors on the R5
// golden case), so its compilation is compared after setting aside exactly these defects, which are
// listed here and in the ADR-0007 addendum; everything else must be equal:
//   - `element` written as a one-item array (R5 defines a single string);
//   - rule names without their "-" (`R-001` → `R001`);
//   - FML comments copied into `documentation`, no narrative (`text`) and an extra
//     `resourceDefinition`;
//   - conditions without their outer parentheses.
// Our R5 JSON is the one committed and exported: it validates as R5 with 0 errors and the engine
// runs it (tests/run-all.sh). Usage: node compare-structuremap.mjs <compiled> <ours> <fhirVersion>
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const [compiledFile, oursFile, fhirVersion] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const r5 = fhirVersion?.startsWith("5.") ?? false;

/** `engine`: the compiled side. `key`: the property the value sits under. */
function normalize(value, key, engine) {
  if (Array.isArray(value)) {
    if (r5 && engine && key === "element" && value.length === 1 && typeof value[0] === "string")
      return value[0];
    return value.map((item) => normalize(item, key === "rule" ? "rule item" : undefined, engine));
  }
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [k, item] of Object.entries(value)) {
    if (k === "status") continue;
    if (r5 && ["documentation", "resourceDefinition", "text"].includes(k)) continue;
    if (r5 && key === "rule item" && k === "name" && typeof item === "string")
      out[k] = item.replaceAll("-", "");
    else if (r5 && k === "condition" && typeof item === "string")
      out[k] = item.replace(/^\((.*)\)$/s, "$1");
    else out[k] = normalize(item, k, engine);
  }
  return out;
}

const equal = isDeepStrictEqual(
  normalize(read(compiledFile), undefined, true),
  normalize(read(oursFile), undefined, false),
);
process.exit(equal ? 0 : 1);
