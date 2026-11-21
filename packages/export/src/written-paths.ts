/**
 * The planner of written paths (#156, ADR-0023): every path the generator writes
 * (`pathsToWrite`) resolved with the FHIR definitions, segment by segment, and handed to the
 * generator as plain data, so `@cindermed/fml` does not depend on `@cindermed/fhir-defs`. A
 * choice element gets its base name and the type the path chooses (`valueString` → `value`,
 * `string`); any other element keeps its own name (`doseQuantity`).
 */
import { type FhirDefinitions, resolvePath } from "@cindermed/fhir-defs";
import { type WrittenPaths, type WrittenSegment, pathKey, pathsToWrite } from "@cindermed/fml";
import type { Instance, ProjectFile } from "@cindermed/model";

/** The definition a role's paths resolve in: its profile when it constrains the role's type. */
export function roleRef(defs: FhirDefinitions, instance: Instance): string {
  return instance.profile !== undefined &&
    defs.entry(instance.profile)?.type === instance.resourceType
    ? instance.profile
    : instance.resourceType;
}

/** The segments of one path as written, or why it does not resolve. */
export function writtenSegments(
  defs: FhirDefinitions,
  ref: string,
  path: string,
): { readonly segments: WrittenSegment[] } | { readonly message: string } {
  const parts = path.split(".");
  const segments: WrittenSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join(".");
    const resolved = resolvePath(defs, ref, prefix);
    if (!resolved.ok) return { message: resolved.issue.message };
    const choice = resolved.value.choice;
    const name = (parts[i] ?? "").replace(/\[.*\]$/, "");
    segments.push(
      choice === undefined
        ? { name }
        : { name: choice.element.slice(0, -"[x]".length), choiceType: choice.type },
    );
  }
  return { segments };
}

/**
 * The written paths of every role of a project. A path that does not resolve is an error of the
 * FHIR checks (`validateFhir`), which block the export before the generator runs; reaching one
 * here is a bug.
 */
export function writtenPaths(project: ProjectFile, defs: FhirDefinitions): WrittenPaths {
  const paths = new Map<string, readonly WrittenSegment[]>();
  for (const instance of project.instances) {
    const ref = roleRef(defs, instance);
    for (const path of pathsToWrite(project, instance)) {
      const found = writtenSegments(defs, ref, path);
      if ("message" in found)
        throw new Error(
          `${instance.resourceType}.${path} does not resolve (${found.message}): the FHIR checks should have blocked the export.`,
        );
      paths.set(pathKey(instance.id, path), found.segments);
    }
  }
  return paths;
}
