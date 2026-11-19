/**
 * Project validation, FHIR level (specification, "Project validation"): the checks that need the
 * FHIR definitions. This file holds the path checks of D7, the FHIR half of integrity rules 4 and
 * 8 (ADR-0005):
 * - every role's resource type and profile exist;
 * - every path resolves in the role's type or profile: mapping rows, fixed values, the elements
 *   set by value-map actions, and declared slices with their discriminators;
 * - a slice sits on a repeating element;
 * - `repeat: eachValue` writes to a repeating element;
 * - every row's transform, every fixed value and every value-action value fits the element's type
 *   (type compatibility, `type-compat.ts`);
 * - every code written to a bound element is in its ValueSet (bindings, `binding.ts`);
 * - references point to allowed types, required references are written, no role is orphan
 *   (F4, `references.ts`);
 * - single-valued elements get one value (cardinality, `cardinality.ts`).
 * Results have the shape of every other level. Errors block the export.
 */
import {
  type Column,
  type FhirValue,
  type Instance,
  type MappingRow,
  type ValueMap,
  type ObjectKind,
  type ProjectFile,
  type ValidationResult,
  rowValueMaps,
} from "@cindermed/model";
import type { FhirDefinitions, IndexFetch } from "./definitions.js";
import { BindingCode, checkBinding, rowCodes, valueCodes } from "./binding.js";
import { checkCardinality } from "./cardinality.js";
import { checkReferences } from "./references.js";
import { type TypeFinding, checkRowTypes, checkValueType } from "./type-compat.js";
import {
  type PathIssueCode,
  type ResolvedElement,
  resolvePath,
  withDefinitions,
} from "./element-tree.js";

/** Stable codes of the FHIR level. */
export const FhirCode = {
  /** The project's FHIR version is not the one of the definitions given. */
  FHIR_VERSION_MISMATCH: "FHIR_VERSION_MISMATCH",
  /** A role's resource type is not a resource type of the FHIR version. */
  RESOURCE_TYPE_UNKNOWN: "RESOURCE_TYPE_UNKNOWN",
  /** A role's profile is not in the definitions (core package or listed packages). */
  PROFILE_UNKNOWN: "PROFILE_UNKNOWN",
  /** A role's profile does not constrain the role's resource type. */
  PROFILE_TYPE_MISMATCH: "PROFILE_TYPE_MISMATCH",
  /** No element with this name (ADR-0014). */
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  /** A choice element used without its type (`value` instead of `valueQuantity`). */
  CHOICE_TYPE_REQUIRED: "CHOICE_TYPE_REQUIRED",
  /** A named slice on an element that does not repeat (rule 4). */
  SLICE_NOT_REPEATING: "SLICE_NOT_REPEATING",
  /** A path through `extension` or `modifierExtension`: not mappable in the MVP. */
  EXTENSION_NOT_SUPPORTED: "EXTENSION_NOT_SUPPORTED",
  /** An element or slice the role's profile prohibits (`max` 0). */
  PATH_PROHIBITED: "PATH_PROHIBITED",
  /** `repeat: eachValue` towards an element that does not repeat (rule 8). */
  REPEAT_TARGET_NOT_REPEATING: "REPEAT_TARGET_NOT_REPEATING",
  /** A definition the check needs is not loaded (load the project's documents first). */
  DEFINITION_NOT_LOADED: "DEFINITION_NOT_LOADED",
} as const;
export type FhirCode = (typeof FhirCode)[keyof typeof FhirCode];

const PATH_CODES: Record<PathIssueCode, FhirCode> = {
  DEFINITION_UNKNOWN: FhirCode.DEFINITION_NOT_LOADED,
  TYPE_NOT_LOADED: FhirCode.DEFINITION_NOT_LOADED,
  PATH_NOT_FOUND: FhirCode.PATH_NOT_FOUND,
  CHOICE_TYPE_REQUIRED: FhirCode.CHOICE_TYPE_REQUIRED,
  SLICE_NOT_REPEATING: FhirCode.SLICE_NOT_REPEATING,
  EXTENSION_NOT_SUPPORTED: FhirCode.EXTENSION_NOT_SUPPORTED,
  PATH_PROHIBITED: FhirCode.PATH_PROHIBITED,
  NOT_A_REFERENCE: FhirCode.PATH_NOT_FOUND,
};

interface Owner {
  readonly objectKind: ObjectKind;
  readonly id?: string;
}

/** A path to check: where it is written, in which role, and what it is for. */
interface PathUse {
  readonly owner: Owner;
  readonly field: string;
  readonly instance: Instance;
  readonly path: string;
  /** How the message names the use: `R-003`, `fixed value`, `slice component[nrs]`. */
  readonly label: string;
  /** For `repeat: eachValue`: the element at the end of the path must repeat. */
  readonly mustRepeat?: boolean;
  /** The mapping row writing to the path: its transform is type-checked (D7). */
  readonly row?: MappingRow;
  /** A typed value written to the path (fixed value, discriminator, value action), and its field. */
  readonly value?: { readonly value: FhirValue; readonly field: string };
}

const roleKey = (instance: Instance) => `${instance.resourceType}[${String(instance.index)}]`;
const repeats = (max: string) => max === "*" || Number(max) > 1;

/**
 * The type or profile a role's paths resolve in: its profile when the profile is valid, else its
 * resource type; `undefined` when the resource type itself is unknown.
 */
function roleDefinition(defs: FhirDefinitions, instance: Instance): string | undefined {
  if (instance.profile !== undefined) {
    const entry = defs.entry(instance.profile);
    if (entry?.kind === "resource" && entry.type === instance.resourceType) return instance.profile;
  }
  return defs.resourceTypes().includes(instance.resourceType) ? instance.resourceType : undefined;
}

/** Every path the project writes, with its role (the uses rule 4 enumerates, plus slices). */
function pathUses(project: ProjectFile): PathUse[] {
  const uses: PathUse[] = [];
  const instances = new Map(project.instances.map((i) => [i.id, i]));
  for (const instance of project.instances) {
    const owner = { objectKind: "instance" as const, id: instance.id };
    instance.slices?.forEach((slice, i) => {
      const label = `slice ${slice.path}[${slice.name}]`;
      uses.push({
        owner,
        field: `slices.${String(i)}.path`,
        instance,
        path: `${slice.path}[${slice.name}]`,
        label,
      });
      slice.discriminator.forEach((d, j) => {
        uses.push({
          owner,
          field: `slices.${String(i)}.discriminator.${String(j)}.path`,
          instance,
          path: `${slice.path}[${slice.name}].${d.path}`,
          label: `discriminator of ${label}`,
          value: { value: d.value, field: `slices.${String(i)}.discriminator.${String(j)}.value` },
        });
      });
    });
    instance.fixedValues?.forEach((fixed, i) => {
      uses.push({
        owner,
        field: `fixedValues.${String(i)}.path`,
        instance,
        path: fixed.path,
        label: "fixed value",
        value: { value: fixed.value, field: `fixedValues.${String(i)}.value` },
      });
    });
  }
  const valueMaps = new Map(project.valueMaps.map((m) => [m.id, m]));
  for (const row of project.mappings) {
    const instance = instances.get(row.instanceId);
    if (instance === undefined) continue; // A dangling role is integrity rule 1.
    uses.push({
      owner: { objectKind: "mapping", id: row.id },
      field: "path",
      instance,
      path: row.path,
      label: row.code,
      mustRepeat: row.repeat?.kind === "eachValue",
      row,
    });
    // Elements set by value actions belong to the role of the row that uses the value map.
    for (const { valueMapId } of rowValueMaps(row)) {
      const valueMap = valueMaps.get(valueMapId);
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
          uses.push({
            owner: { objectKind: "valueMap", id: valueMap.id },
            field: `entries.${String(i)}.action.${key}.${String(j)}.path`,
            instance,
            path: set.path,
            label: `value map ${valueMap.name} (used by ${row.code})`,
            value: {
              value: set.value,
              field: `entries.${String(i)}.action.${key}.${String(j)}.value`,
            },
          });
        });
      });
    }
  }
  return uses;
}

function result(
  owner: Owner,
  field: string,
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
): ValidationResult {
  return {
    severity,
    code,
    objectKind: owner.objectKind,
    ...(owner.id === undefined ? {} : { id: owner.id }),
    field,
    message,
  };
}

/**
 * The FHIR-level path checks of a project, on definitions of the project's FHIR version with every
 * document the project needs loaded (`loadProjectDefinitions` loads them on demand).
 */
export function validateFhir(project: ProjectFile, defs: FhirDefinitions): ValidationResult[] {
  if (project.project.fhirVersion !== defs.fhirVersion)
    return [
      result(
        { objectKind: "project", id: project.project.id },
        "project.fhirVersion",
        FhirCode.FHIR_VERSION_MISMATCH,
        `the project is for FHIR ${project.project.fhirVersion}, the definitions are for FHIR ${defs.fhirVersion}`,
      ),
    ];
  const results: ValidationResult[] = [];
  const known = new Set(defs.resourceTypes());
  for (const instance of project.instances) {
    const owner = { objectKind: "instance" as const, id: instance.id };
    if (!known.has(instance.resourceType)) {
      results.push(
        result(
          owner,
          "resourceType",
          FhirCode.RESOURCE_TYPE_UNKNOWN,
          `${roleKey(instance)}: ${instance.resourceType} is not a resource type of FHIR ${defs.fhirVersion}`,
        ),
      );
      continue;
    }
    if (instance.profile === undefined) continue;
    const entry = defs.entry(instance.profile);
    if (entry === undefined)
      results.push(
        result(
          owner,
          "profile",
          FhirCode.PROFILE_UNKNOWN,
          `${roleKey(instance)}: profile ${instance.profile} is not in the core package or the project's packages`,
        ),
      );
    else if (entry.kind !== "resource" || entry.type !== instance.resourceType)
      results.push(
        result(
          owner,
          "profile",
          FhirCode.PROFILE_TYPE_MISMATCH,
          `${roleKey(instance)}: profile ${instance.profile} constrains ${entry.type}, not ${instance.resourceType}`,
        ),
      );
  }

  const context = {
    columns: new Map<string, Column>(
      project.sources.flatMap((source) => source.columns.map((c) => [c.id, c] as const)),
    ),
    valueMaps: new Map(project.valueMaps.map((m) => [m.id, m])),
  };
  // The same value-map path may be checked once per row that uses the map: report it once.
  const seen = new Set<string>();
  for (const use of pathUses(project)) {
    const ref = roleDefinition(defs, use.instance);
    if (ref === undefined) continue; // Reported above as RESOURCE_TYPE_UNKNOWN.
    const where = `${use.label}: ${use.instance.resourceType}.${use.path}`;
    const resolved = resolvePath(defs, ref, use.path);
    const found: ValidationResult[] = [];
    if (!resolved.ok)
      found.push(
        result(
          use.owner,
          use.field,
          PATH_CODES[resolved.issue.code],
          `${where}: ${resolved.issue.message}`,
        ),
      );
    else {
      if (use.mustRepeat === true && !repeats(resolved.value.max))
        found.push(repeatResult(use, where, resolved.value));
      const findings: TypeFinding[] = [];
      if (use.row !== undefined)
        findings.push(
          ...checkRowTypes(defs, context, use.row, use.instance.resourceType, resolved.value),
        );
      if (use.value !== undefined) {
        const finding = checkValueType(
          defs,
          use.value.value,
          use.instance.resourceType,
          resolved.value,
          use.label,
        );
        if (finding !== undefined) findings.push({ ...finding, field: use.value.field });
      }
      for (const f of findings)
        found.push(result(use.owner, f.field, f.code, f.message, f.severity));
      // Bindings (ADR-0016): only for values that can be written at all.
      if (!findings.some((f) => f.severity === "error"))
        found.push(...bindingResults(defs, context, use, resolved.value));
    }
    for (const item of found) {
      const key = `${item.objectKind}|${item.id ?? ""}|${item.field ?? ""}|${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  }
  // References (F4, ADR-0017).
  results.push(...checkReferences(project, defs, (instance) => roleDefinition(defs, instance)));
  // Cardinality, first version (ADR-0018).
  results.push(...checkCardinality(project, defs, (instance) => roleDefinition(defs, instance)));
  return results;
}

/** The binding findings of a path use whose element resolved, on the object that holds each code. */
function bindingResults(
  defs: FhirDefinitions,
  context: {
    readonly columns: ReadonlyMap<string, Column>;
    readonly valueMaps: ReadonlyMap<string, ValueMap>;
  },
  use: PathUse,
  element: ResolvedElement,
): ValidationResult[] {
  const where = `${use.label}: ${use.instance.resourceType}.${use.path}`;
  if (use.value !== undefined) {
    const value = use.value;
    return checkBinding(defs, element, valueCodes(value.value), where).map((f) =>
      result(use.owner, value.field, BindingCode.BINDING_VIOLATION, f.message, f.severity),
    );
  }
  if (use.row === undefined) return [];
  const { codes, valueMap } = rowCodes(use.row, context.columns, context.valueMaps);
  return checkBinding(defs, element, codes, where).map((f) => {
    // A value-map code belongs to its entry; a constant to the row's transform; a copied
    // categorical column to the row (its column needs a value map).
    if (valueMap !== undefined && f.field !== undefined)
      return result(
        { objectKind: "valueMap", id: valueMap.id },
        f.field,
        BindingCode.BINDING_VIOLATION,
        f.message,
        f.severity,
      );
    return result(
      use.owner,
      f.field ?? (use.row?.transform.kind === "copy" ? "columnId" : "path"),
      BindingCode.BINDING_VIOLATION,
      f.message,
      f.severity,
    );
  });
}

function repeatResult(use: PathUse, where: string, element: ResolvedElement): ValidationResult {
  return result(
    use.owner,
    "repeat",
    FhirCode.REPEAT_TARGET_NOT_REPEATING,
    `${where}: repeat eachValue writes one repetition per value, but ${element.elementId} does not repeat (max ${element.max})`,
  );
}

/**
 * Loads, through `fetch`, every document the project's paths need, so that `validateFhir` can run
 * on definitions opened from a manifest (the browser). Problems loading are left for
 * `validateFhir` to report.
 */
export async function loadProjectDefinitions(
  project: ProjectFile,
  defs: FhirDefinitions,
  fetch: IndexFetch,
): Promise<void> {
  for (const instance of project.instances) {
    const refs = [
      instance.resourceType,
      ...(instance.profile === undefined ? [] : [instance.profile]),
    ].filter((ref) => defs.entry(ref) !== undefined && !defs.isLoaded(ref));
    if (refs.length > 0) await defs.load(refs, fetch);
  }
  for (const use of pathUses(project)) {
    const ref = roleDefinition(defs, use.instance);
    if (ref === undefined) continue;
    const resolved = await withDefinitions(defs, fetch, () => resolvePath(defs, ref, use.path));
    const valueSet = resolved.ok ? resolved.value.binding?.valueSet : undefined;
    if (valueSet !== undefined && defs.valueSet(valueSet) === undefined)
      await defs.load([valueSet], fetch);
  }
}
