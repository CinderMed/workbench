/**
 * Profile slice names a project cannot write (D7; #150; ADR-0020):
 * - SLICE_NAME_UNUSABLE (warning): a role's profile requires a slice (min ≥ 1) of a top-level
 *   element whose name does not match the slice names of the project format,
 *   `[A-Za-z][A-Za-z0-9-]*`. The slice still resolves, but no path in the project can name it, so
 *   the generator cannot write it and the resource may not conform to the profile.
 */
import type { Instance, ProjectFile, ValidationResult } from "@cindermed/model";
import type { FhirDefinitions } from "./definitions.js";
import { elementTree } from "./element-tree.js";

export const SliceNameCode = {
  SLICE_NAME_UNUSABLE: "SLICE_NAME_UNUSABLE",
} as const;

/** Slice names a project path can hold (`ElementPath` and `Slice.name`, project format 1.4.0). */
const USABLE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Whether a profile slice name can be written in a project path. */
export function usableSliceName(name: string): boolean {
  return USABLE.test(name);
}

/**
 * The required top-level profile slices of each role that a project cannot name. `definitionOf`
 * gives the type or profile a role's paths resolve in; roles without a profile are left out
 * (core resources define no slices).
 */
export function checkSliceNames(
  project: ProjectFile,
  defs: FhirDefinitions,
  definitionOf: (instance: Instance) => string | undefined,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const instance of project.instances) {
    const ref = definitionOf(instance);
    if (ref === undefined || ref === instance.resourceType) continue;
    const tree = elementTree(defs, ref);
    if (!tree.ok) continue;
    for (const node of tree.value) {
      if (node.sliceName === undefined || node.min < 1 || usableSliceName(node.sliceName)) continue;
      results.push({
        severity: "warning",
        code: SliceNameCode.SLICE_NAME_UNUSABLE,
        objectKind: "instance",
        id: instance.id,
        field: "profile",
        message: `${instance.resourceType}[${String(instance.index)}]: the profile requires slice ${node.name} (min ${String(node.min)}), but its name cannot be written in a project path (letters, digits and '-', starting with a letter): the resource may not conform to the profile`,
      });
    }
  }
  return results;
}
