/**
 * Interim (#156): the choice paths the old generator wrote wrongly stay blocked until a golden
 * case covers them. The generator now takes names and choice types from the FHIR definitions
 * (ADR-0023), but a translation rule is turned on only with its golden case, run by the HL7 engine.
 * This check still uses the old name list (ADR-0011) to find exactly the paths it wrote wrongly:
 * names that differ from the definitions, and paths through a choice. Removed by the fixtures PR
 * that adds those golden cases.
 */
import { type FhirDefinitions, resolvePath } from "@cindermed/fhir-defs";
import { GeneratorCode } from "@cindermed/fml";
import type { Instance, ObjectKind, ProjectFile, ValidationResult } from "@cindermed/model";

const OLD_CHOICE_ELEMENTS =
  "value effective onset abatement deceased multipleBirth occurrence performed timing born age serviced collected asNeeded dose rate medication reported product allowed used".split(
    " ",
  );
const OLD_CHOICE_TYPES =
  "Boolean Canonical Code Date DateTime Decimal Id Instant Integer Markdown Oid PositiveInt String Time UnsignedInt Uri Url Uuid Address Age Annotation Attachment CodeableConcept Coding ContactPoint Count Distance Duration HumanName Identifier Money Period Quantity Range Ratio Reference SampledData Signature Timing".split(
    " ",
  );
const OLD_CHOICE = new RegExp(
  `^(${OLD_CHOICE_ELEMENTS.join("|")})(${OLD_CHOICE_TYPES.join("|")})$`,
);

/** The name the old generator wrote (ADR-0011's list): a listed choice without its type. */
const oldName = (name: string): string => OLD_CHOICE.exec(name)?.[1] ?? name;

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
    const written = oldName(segment.name);
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
