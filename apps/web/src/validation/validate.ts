/**
 * The same checks as `cindermed validate` (ADR-0021, section 5): schema, integrity and quality
 * (`@cindermed/model`), then the FHIR checks (`@cindermed/fhir-defs`) when the definitions of the
 * project's FHIR version are available. Pure apart from `fetch`: the worker and the tests use it.
 */
import {
  FhirDefinitions,
  type IndexFetch,
  loadProjectDefinitions,
  validateFhir,
} from "@cindermed/fhir-defs";
import { type ProjectFile, type ValidationResult, validateProject } from "@cindermed/model";

/** Whether the FHIR checks ran, and why not. */
export type FhirStatus =
  | { readonly kind: "checked"; readonly fhirVersion: string }
  | { readonly kind: "notRun" } // The project does not match the schema.
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "otherVersion"; readonly indexVersion: string };

export interface Validation {
  readonly results: readonly ValidationResult[];
  readonly fhir: FhirStatus;
}

/** Opens the definition index (`index.json`) through `fetch`; a message when it cannot. */
export async function openDefinitions(
  fetch: IndexFetch,
): Promise<{ readonly defs: FhirDefinitions } | { readonly message: string }> {
  let text: string;
  try {
    text = await fetch("index.json");
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return { message: "index.json is not JSON" };
  }
  const opened = FhirDefinitions.open(manifest);
  return opened.ok ? { defs: opened.value } : { message: "index.json is not a definition index" };
}

export async function validateAll(
  project: ProjectFile,
  definitions:
    { readonly defs: FhirDefinitions; readonly fetch: IndexFetch } | { readonly message: string },
): Promise<Validation> {
  const results = validateProject(project);
  if (results.some((r) => r.code === "SCHEMA_VIOLATION"))
    return { results, fhir: { kind: "notRun" } };
  if ("message" in definitions)
    return { results, fhir: { kind: "unavailable", message: definitions.message } };
  const { defs, fetch } = definitions;
  if (defs.fhirVersion !== project.project.fhirVersion)
    return { results, fhir: { kind: "otherVersion", indexVersion: defs.fhirVersion } };
  await loadProjectDefinitions(project, defs, fetch);
  return {
    results: [...results, ...validateFhir(project, defs)],
    fhir: { kind: "checked", fhirVersion: defs.fhirVersion },
  };
}
