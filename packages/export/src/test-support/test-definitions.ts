/**
 * Tests only: the R4 and R5 definitions of the fixture projects, from the committed subsets of the
 * definition index (r4-index.json, r5-index.json; ADR-0023, #78; rebuilt and checked by
 * tooling/export-test-index.test.ts). Every document of a subset is loaded, so the export can run
 * synchronously.
 */
import { FhirDefinitions, type IndexPackage } from "@cindermed/fhir-defs";
import r4Text from "./r4-index.json?raw";
import r5Text from "./r5-index.json?raw";

interface Subset {
  readonly manifest: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * The test definitions of a FHIR version: 4.0.1 or 5.0.0. `packages` replaces the packages the
 * index says it was built from (for the manifest's package list, #146).
 */
export function testDefinitions(
  fhirVersion: string,
  packages?: readonly IndexPackage[],
): FhirDefinitions {
  const text = fhirVersion.startsWith("5.") ? r5Text : r4Text;
  const subset = JSON.parse(text) as Subset;
  const manifest = JSON.parse(subset.manifest) as Record<string, unknown>;
  if (packages !== undefined) manifest["packages"] = packages;
  const opened = FhirDefinitions.open(manifest);
  if (!opened.ok) throw new Error(`the ${fhirVersion} test index does not open`);
  for (const [file, doc] of Object.entries(subset.files)) {
    const added = opened.value.add(file, doc);
    if (!added.ok) throw new Error(`${file}: ${JSON.stringify(added)}`);
  }
  return opened.value;
}

export const r4Definitions = (): FhirDefinitions => testDefinitions("4.0.1");
