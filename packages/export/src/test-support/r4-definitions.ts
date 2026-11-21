/**
 * Tests only: the R4 definitions of the fixture projects, from the committed subset of the R4
 * definition index (r4-index.json, ADR-0023; rebuilt and checked by
 * tooling/export-test-index.test.ts). Every document of the subset is loaded, so the export can run
 * synchronously.
 */
import { FhirDefinitions } from "@cindermed/fhir-defs";
import indexText from "./r4-index.json?raw";

interface Subset {
  readonly manifest: string;
  readonly files: Readonly<Record<string, string>>;
}

export function r4Definitions(): FhirDefinitions {
  const subset = JSON.parse(indexText) as Subset;
  const opened = FhirDefinitions.open(JSON.parse(subset.manifest));
  if (!opened.ok) throw new Error("the R4 test index does not open");
  for (const [file, text] of Object.entries(subset.files)) {
    const added = opened.value.add(file, text);
    if (!added.ok) throw new Error(`${file}: ${JSON.stringify(added)}`);
  }
  return opened.value;
}
