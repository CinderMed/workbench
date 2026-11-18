/**
 * Choice elements the generator cannot write yet (#156). The generator names choice elements from
 * a fixed list of R4 names (ADR-0011) instead of the FHIR definitions, and writes a path through a
 * choice (`valueQuantity.value`) without a type. The HL7 engine then fails, or the StructureMap does
 * not validate. With the definitions at hand, the export compares, for every path, the name the
 * generator writes with the name the definitions require, and blocks the paths that differ with the
 * generator's own code, PATH_UNSUPPORTED. To be removed when the generator uses the definitions.
 */
import { type FhirDefinitions, resolvePath } from "@cindermed/fhir-defs";
import { GeneratorCode, fmlElement } from "@cindermed/fml";
import type { Instance, ObjectKind, ProjectFile, ValidationResult } from "@cindermed/model";

/** The element name in a snapshot id: `value[x]` for `Observation.value[x]:valueQuantity`. */
function snapshotName(elementId: string): string {
  const last = elementId.slice(elementId.lastIndexOf(".") + 1);
  const colon = last.indexOf(":");
  return colon < 0 ? last : last.slice(0, colon);
}

/** Why the generator cannot write this path, or `undefined` when it can. */
export function choiceProblem(
  defs: FhirDefinitions,
  ref: string,
  path: string,
): string | undefined {
  const resolved = resolvePath(defs, ref, path);
  if (!resolved.ok) return undefined; // Reported by the FHIR checks.
  const segments = resolved.value.segments;
  for (const [i, segment] of segments.entries()) {
    const name = snapshotName(segment.elementId);
    const choice = name.endsWith("[x]");
    if (choice && i < segments.length - 1)
      return `${segment.name} is a choice element: a path through it (${path}) cannot be written yet (#156)`;
    const required = choice ? name.slice(0, -3) : name;
    const written = String(fmlElement(segment.name));
    if (written !== required)
      return `the generator would write ${segment.name} as "${written}", but the element is "${required}"${choice ? " (a choice)" : ""}: it cannot be written yet (#156)`;
  }
  return undefined;
}

/** The PATH_UNSUPPORTED results of a project's paths that the generator would write wrongly. */
export function choicePathResults(project: ProjectFile, defs: FhirDefinitions): ValidationResult[] {
  const results: ValidationResult[] = [];
  const refOf = (instance: Instance) =>
    instance.profile !== undefined && defs.entry(instance.profile)?.type === instance.resourceType
      ? instance.profile
      : instance.resourceType;
  const check = (
    instance: Instance,
    path: string,
    objectKind: ObjectKind,
    id: string,
    field: string,
    label: string,
  ) => {
    const problem = choiceProblem(defs, refOf(instance), path);
    if (problem !== undefined)
      results.push({
        severity: "error",
        code: GeneratorCode.PATH_UNSUPPORTED,
        objectKind,
        id,
        field,
        message: `${label}: ${instance.resourceType}.${path}: ${problem}`,
      });
  };
  for (const instance of project.instances)
    instance.fixedValues?.forEach((fixed, i) => {
      check(
        instance,
        fixed.path,
        "instance",
        instance.id,
        `fixedValues.${String(i)}.path`,
        "fixed value",
      );
    });
  const instances = new Map(project.instances.map((i) => [i.id, i]));
  for (const row of project.mappings) {
    const instance = instances.get(row.instanceId);
    if (instance !== undefined) check(instance, row.path, "mapping", row.id, "path", row.code);
  }
  return results;
}
