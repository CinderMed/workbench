/**
 * Reference checks (F4; integrity rule 5, FHIR part, ADR-0005; ADR-0017):
 * - REF_TARGET_NOT_ALLOWED (error): a reference row points to a role whose resource type the
 *   element's `targetProfile` does not allow;
 * - REFERENCE_REQUIRED_MISSING (warning): a role's resource has a top-level Reference with
 *   `min` ≥ 1 that no row or fixed value writes;
 * - ROLE_ORPHAN (warning): in a project with two or more roles, a role that references no other
 *   role and that no other role references.
 */
import type { Instance, ProjectFile, ValidationResult } from "@cindermed/model";
import type { FhirDefinitions } from "./definitions.js";
import { elementTree, referenceTargets } from "./element-tree.js";

export const ReferenceCode = {
  REF_TARGET_NOT_ALLOWED: "REF_TARGET_NOT_ALLOWED",
  REFERENCE_REQUIRED_MISSING: "REFERENCE_REQUIRED_MISSING",
  ROLE_ORPHAN: "ROLE_ORPHAN",
} as const;

const roleKey = (instance: Instance) => `${instance.resourceType}[${String(instance.index)}]`;
const REFERENCE_TYPES: ReadonlySet<string> = new Set(["Reference", "CodeableReference"]);

/** Whether a path writes into the top-level element `name` (`subject`, `subject.reference`, `component[x]…`). */
function writes(path: string, name: string): boolean {
  return path === name || path.startsWith(`${name}.`) || path.startsWith(`${name}[`);
}

/**
 * The reference findings of a project. `definitionOf` gives the type or profile a role's paths
 * resolve in, or `undefined` when its resource type is unknown (reported elsewhere).
 */
export function checkReferences(
  project: ProjectFile,
  defs: FhirDefinitions,
  definitionOf: (instance: Instance) => string | undefined,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const instances = new Map(project.instances.map((i) => [i.id, i]));
  const linked = new Set<string>();

  // REF_TARGET_NOT_ALLOWED, and the links between roles.
  for (const row of project.mappings) {
    if (row.transform.kind !== "reference") continue;
    const source = instances.get(row.instanceId);
    const target = instances.get(row.transform.targetInstanceId);
    if (source === undefined || target === undefined) continue; // Integrity rule 1.
    linked.add(source.id);
    linked.add(target.id);
    const ref = definitionOf(source);
    if (ref === undefined) continue;
    const allowed = referenceTargets(defs, ref, row.path);
    if (!allowed.ok || allowed.value.any) continue; // Path and type errors are reported by D7.
    const { resourceTypes, unknown } = allowed.value;
    if (resourceTypes.includes(target.resourceType)) continue;
    const where = `${row.code}: ${source.resourceType}.${row.path}`;
    const known =
      resourceTypes.length === 0 ? "no resource type in the definitions" : resourceTypes.join(", ");
    results.push(
      unknown.length > 0 && resourceTypes.length === 0
        ? {
            severity: "warning",
            code: ReferenceCode.REF_TARGET_NOT_ALLOWED,
            objectKind: "mapping",
            id: row.id,
            field: "transform.targetInstanceId",
            message: `${where}: target not checked: its target profiles (${unknown.join(", ")}) are not in the definitions`,
          }
        : {
            severity: "error",
            code: ReferenceCode.REF_TARGET_NOT_ALLOWED,
            objectKind: "mapping",
            id: row.id,
            field: "transform.targetInstanceId",
            message: `${where} allows ${known}, not ${roleKey(target)} (${target.resourceType})`,
          },
    );
  }

  // REFERENCE_REQUIRED_MISSING: required top-level references that nothing writes.
  for (const instance of project.instances) {
    const ref = definitionOf(instance);
    if (ref === undefined) continue;
    const tree = elementTree(defs, ref);
    if (!tree.ok) continue;
    const paths = [
      ...project.mappings.filter((r) => r.instanceId === instance.id).map((r) => r.path),
      ...(instance.fixedValues ?? []).map((f) => f.path),
    ];
    for (const node of tree.value) {
      if (node.choice !== undefined || node.min < 1) continue;
      if (!node.types.some((t) => REFERENCE_TYPES.has(t.code))) continue;
      if (paths.some((path) => writes(path, node.name))) continue;
      results.push({
        severity: "warning",
        code: ReferenceCode.REFERENCE_REQUIRED_MISSING,
        objectKind: "instance",
        id: instance.id,
        field: "resourceType",
        message: `${roleKey(instance)}: ${instance.resourceType}.${node.name} is required (min ${String(node.min)}), but no row writes it: the resource would be invalid`,
      });
    }
  }

  // ROLE_ORPHAN: roles with no reference in or out.
  if (project.instances.length >= 2)
    for (const instance of project.instances) {
      if (linked.has(instance.id)) continue;
      results.push({
        severity: "warning",
        code: ReferenceCode.ROLE_ORPHAN,
        objectKind: "instance",
        id: instance.id,
        message: `${roleKey(instance)} (${instance.label ?? instance.resourceType}) references no other role and no role references it`,
      });
    }
  return results;
}
