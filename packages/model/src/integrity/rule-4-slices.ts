// Rule 4 (structural part): the slices used in a path are declared in the role.
// That the path exists in the StructureDefinition, and that a slice sits on a repeating element,
// needs the FHIR definitions and is checked in module 3 (D7, ADR-0005).
import type { Instance } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import { rowValueMaps, type Owner, type ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

/** Named slices of a path, e.g. `component[nrs].valueInteger` → `{ path: "component", name: "nrs" }`. */
export function slicesInPath(path: string): { path: string; name: string }[] {
  const slices: { path: string; name: string }[] = [];
  const pattern = /\[([^\]]+)\]/g;
  for (const match of path.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) slices.push({ path: path.slice(0, match.index), name });
  }
  return slices;
}

function checkPath(
  instance: Instance,
  path: string,
  owner: Owner,
  field: string,
  results: ValidationResult[],
): void {
  for (const used of slicesInPath(path)) {
    const declared = instance.slices?.some(
      (slice) => slice.name === used.name && slice.path === used.path,
    );
    if (declared !== true) {
      results.push(
        error(
          IntegrityCode.SLICE_NOT_DECLARED,
          owner,
          field,
          `slice ${used.path}[${used.name}] is not declared in role ${instance.resourceType}[${String(instance.index)}]`,
        ),
      );
    }
  }
}

export function checkSlices(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const instance of index.project.instances) {
    const owner: Owner = { objectKind: "instance", id: instance.id };
    instance.fixedValues?.forEach((fixed, i) => {
      checkPath(instance, fixed.path, owner, `fixedValues.${String(i)}.path`, results);
    });
  }

  for (const row of index.project.mappings) {
    const instance = index.instances.get(row.instanceId);
    if (instance === undefined) continue;
    const owner: Owner = { objectKind: "mapping", id: row.id };
    checkPath(instance, row.path, owner, "path", results);
    // Elements set by value actions belong to the role of the row that uses the value map.
    for (const { valueMapId } of rowValueMaps(row)) {
      const valueMap = index.valueMaps.get(valueMapId);
      valueMap?.entries.forEach((entry, i) => {
        const action = entry.action;
        const sets =
          action.kind === "setElement"
            ? action.set
            : action.kind === "use"
              ? (action.also ?? [])
              : [];
        const key = action.kind === "setElement" ? "set" : "also";
        sets.forEach((set, j) => {
          checkPath(
            instance,
            set.path,
            { objectKind: "valueMap", id: valueMap.id },
            `entries.${String(i)}.action.${key}.${String(j)}.path`,
            results,
          );
        });
      });
    }
  }

  return results;
}
