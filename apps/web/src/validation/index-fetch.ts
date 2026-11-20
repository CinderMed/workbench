/**
 * Reads the compact FHIR definition index from the dev server (`/fhir-index/`, written by
 * `cindermed fhir-index`, ADR-0021). Used by the validation worker and by the page (path picker).
 */
import type { FhirDefinitions } from "@cindermed/fhir-defs";
import { openDefinitions } from "./validate";

const BASE = "/fhir-index/";

export async function fetchIndex(file: string): Promise<string> {
  const response = await fetch(`${BASE}${file}`);
  if (!response.ok)
    throw new Error(
      `${BASE}${file}: ${String(response.status)}; write it with cindermed fhir-index --out apps/web/.fhir-index`,
    );
  return response.text();
}

/** The definitions with their fetch, or why they are not there. */
export type BrowserDefinitions =
  | { readonly defs: FhirDefinitions; readonly fetch: (file: string) => Promise<string> }
  | { readonly message: string };

/** Opens the index from the dev server; a failure is not kept, so the next call tries again. */
export function browserDefinitions(): () => Promise<BrowserDefinitions> {
  let opened: Promise<BrowserDefinitions> | undefined;
  return () => {
    opened ??= openDefinitions(fetchIndex).then((found) =>
      "defs" in found ? { defs: found.defs, fetch: fetchIndex } : found,
    );
    const current = opened;
    void current.then((found) => {
      if ("message" in found && opened === current) opened = undefined;
    });
    return current;
  };
}
