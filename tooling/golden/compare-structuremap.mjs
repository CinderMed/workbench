// Compares the StructureMap the HL7 engine compiled with the one our builder wrote (ADR-0007).
// R4: equal apart from `status`, which the compiler does not write.
// R5 (#78): validator 7.0.5 writes an invalid R5 StructureMap, so its compilation is compared after
// setting aside the engine defects in `R5_ENGINE_DEFECTS`, a closed list (ADR-0007 addendum). Each
// defect is matched in one exact form, only where the engine wrote it; any other difference fails.
// Our R5 JSON is the one committed and exported: it validates as R5 with 0 errors and the engine
// runs it (tests/run-all.sh). The HL7 probes record which defects a validator version still shows
// (tooling/hl7-probes, R5 compile).
//
// Usage: node compare-structuremap.mjs <compiled> <ours> <fhirVersion>
// Exit 0 when equal, printing the defects set aside; exit 1 printing every other difference.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

/** The `resourceDefinition` validator 7.0.5 writes into an R5 compilation: an unknown version. */
export const ENGINE_RESOURCE_DEFINITION =
  "http://hl7.org/fhir/StructureDefinition/StructureMap|0.1.0";

/** The closed list of R5 engine defects set aside. Nothing else is. */
export const R5_ENGINE_DEFECTS = {
  "element-array": "`element` written as a one-item array (R5 defines a single string)",
  "rule-name-hyphen": "rule names without their `-` (`R-001` → `R001`)",
  "resource-definition": `an extra \`resourceDefinition\` (${ENGINE_RESOURCE_DEFINITION})`,
  "comment-documentation": "FML comments copied into `documentation` of groups and rules",
  "no-narrative": "no narrative (`text`)",
  "condition-parentheses": "conditions without their outer parentheses",
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Compares the engine's compilation with ours. Returns every difference that is not a listed
 * defect (`differences`, as paths) and the listed defects found (`setAside`, as ids).
 */
export function compareStructureMaps(engine, ours, fhirVersion) {
  const r5 = fhirVersion.startsWith("5.");
  const differences = [];
  const setAside = new Set();

  function walk(e, o, path, inRule) {
    if (Array.isArray(e) && Array.isArray(o)) {
      if (e.length !== o.length) differences.push(`${path} (length ${e.length} ≠ ${o.length})`);
      else e.forEach((item, i) => walk(item, o[i], `${path}[${i}]`, path.endsWith(".rule")));
      return;
    }
    if (isObject(e) && isObject(o)) {
      for (const k of new Set([...Object.keys(e), ...Object.keys(o)])) {
        if (k === "status") continue;
        const [ev, ov, at] = [e[k], o[k], `${path}.${k}`];
        if (r5) {
          const defect = r5Defect(k, ev, ov, path === "", inRule);
          if (defect !== undefined) {
            setAside.add(defect);
            continue;
          }
        }
        if (ev === undefined || ov === undefined)
          differences.push(`${at} (${ev === undefined ? "only in ours" : "only in the engine's"})`);
        else walk(ev, ov, at, false);
      }
      return;
    }
    if (!isDeepStrictEqual(e, o))
      differences.push(`${path} (${JSON.stringify(e)} ≠ ${JSON.stringify(o)})`);
  }

  walk(engine, ours, "", false);
  return { differences, setAside: [...setAside] };
}

/** The listed defect a property shows, in its exact form, or undefined. */
function r5Defect(k, ev, ov, top, inRule) {
  if (
    k === "element" &&
    Array.isArray(ev) &&
    ev.length === 1 &&
    typeof ov === "string" &&
    ev[0] === ov
  )
    return "element-array";
  if (
    k === "name" &&
    inRule &&
    typeof ev === "string" &&
    typeof ov === "string" &&
    ov.includes("-") &&
    ev === ov.replaceAll("-", "")
  )
    return "rule-name-hyphen";
  if (k === "resourceDefinition" && top && ov === undefined && ev === ENGINE_RESOURCE_DEFINITION)
    return "resource-definition";
  if (k === "documentation" && !top && ov === undefined && typeof ev === "string")
    return "comment-documentation";
  if (k === "text" && top && ev === undefined && isObject(ov)) return "no-narrative";
  if (k === "condition" && typeof ev === "string" && typeof ov === "string" && ov === `(${ev})`)
    return "condition-parentheses";
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [compiledFile, oursFile, fhirVersion = "4.0.1"] = process.argv.slice(2);
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  const { differences, setAside } = compareStructureMaps(
    read(compiledFile),
    read(oursFile),
    fhirVersion,
  );
  if (setAside.length > 0) console.log(`  engine defects set aside: ${setAside.join(", ")}`);
  for (const d of differences) console.error(`  differs: ${d}`);
  process.exit(differences.length === 0 ? 0 : 1);
}
