/**
 * Binding checks (D7; specification, "Type compatibility in the grid", Binding; ADR-0016). For a
 * code, Coding or CodeableConcept element with a required, extensible or preferred binding, every
 * code the project writes there (by a value map, a constant, a fixed value, a value action, or a
 * copy of a categorical column's allowed values) must be in the bound ValueSet, expanded offline
 * from the packages (definition index 1.1.0).
 *
 * - required: a code outside the ValueSet is an error; a ValueSet that cannot be expanded offline
 *   gives a warning, "binding not checked";
 * - extensible, preferred: a code outside the ValueSet is a warning; a ValueSet that cannot be
 *   expanded is not reported;
 * - example: never checked.
 */
import type { Column, FhirValue, MappingRow, ValueMap } from "@cindermed/model";
import type { FhirDefinitions } from "./definitions.js";
import type { ResolvedElement } from "./element-tree.js";
import { fhirType } from "./type-compat.js";

export const BindingCode = {
  /** A code outside the bound ValueSet, or (warning) a required binding that cannot be checked. */
  BINDING_VIOLATION: "BINDING_VIOLATION",
} as const;

/** A code the project writes: a bare code (for a `code` element), or a system and a code. */
export interface WrittenCode {
  readonly system?: string;
  readonly code: string;
  /** Where the code comes from, for the message: `entry Sì`, `allowed value 3`. */
  readonly from: string;
  /** The field of the object that holds the code, when it is not the use's own field. */
  readonly field?: string;
}

export interface BindingFinding {
  readonly severity: "error" | "warning";
  readonly field?: string;
  readonly message: string;
}

const CODED: ReadonlySet<string> = new Set(["code", "Coding", "CodeableConcept"]);

/** The codes a typed value writes (constants, fixed values, value actions). */
export function valueCodes(value: FhirValue): WrittenCode[] {
  if (value.type === "code" && typeof value.value === "string")
    return [{ code: value.value, from: "the value" }];
  if (value.type === "Coding" || value.type === "CodeableConcept")
    return [{ system: value.coding.system, code: value.coding.code, from: "the value" }];
  return [];
}

/**
 * The codes a mapping row writes: the targets of its value map, its constant, or the allowed values
 * of a categorical column it copies (values listed as missing are never written).
 */
export function rowCodes(
  row: MappingRow,
  columns: ReadonlyMap<string, Column>,
  valueMaps: ReadonlyMap<string, ValueMap>,
): { readonly codes: WrittenCode[]; readonly valueMap?: ValueMap } {
  const transform = row.transform;
  if (transform.kind === "constant")
    return { codes: valueCodes(transform.value).map((c) => ({ ...c, field: "transform.value" })) };
  if (transform.kind === "valueMap") {
    const valueMap = valueMaps.get(transform.valueMapId);
    if (
      valueMap === undefined ||
      valueMap.target === "boolean" ||
      valueMap.target === "Quantity.unit"
    )
      return { codes: [] };
    const codes: WrittenCode[] = [];
    valueMap.entries.forEach((entry, i) => {
      if (entry.action.kind !== "use" || entry.target === undefined) return;
      const target = entry.target;
      if ("code" in target)
        codes.push({
          system: target.system,
          code: target.code,
          from: `entry ${entry.sourceValue}`,
          field: `entries.${String(i)}.target`,
        });
      else if (typeof target.value === "string")
        codes.push({
          code: target.value,
          from: `entry ${entry.sourceValue}`,
          field: `entries.${String(i)}.target`,
        });
    });
    return { codes, valueMap };
  }
  if (transform.kind === "copy" && row.columnId !== undefined) {
    const column = columns.get(row.columnId);
    if (column?.dataType !== "categorical") return { codes: [] };
    const missing = new Set(column.missingValues ?? []);
    return {
      codes: (column.allowedValues ?? [])
        .filter((v) => !missing.has(v.code))
        .map((v) => ({ code: v.code, from: `allowed value ${v.code} of column ${column.name}` })),
    };
  }
  return { codes: [] };
}

/** The binding findings for codes written to a resolved element (empty when it has no binding to check). */
export function checkBinding(
  defs: FhirDefinitions,
  element: ResolvedElement,
  codes: readonly WrittenCode[],
  where: string,
): BindingFinding[] {
  const binding = element.binding;
  if (binding?.valueSet === undefined || binding.strength === "example" || codes.length === 0)
    return [];
  const types = element.types.map((t) => fhirType(t.code));
  if (!types.some((t) => CODED.has(t))) return [];
  const required = binding.strength === "required";
  const valueSet = binding.valueSet.split("|")[0] ?? binding.valueSet;
  const entry = defs.valueSetEntry(valueSet);
  if (entry?.expandable !== true) {
    if (!required) return [];
    const why = entry === undefined ? "it is not in the definitions" : entry.reason;
    return [
      {
        severity: "warning",
        message: `${where}: binding not checked: the required ValueSet ${valueSet} cannot be expanded offline (${why})`,
      },
    ];
  }
  const expansion = defs.valueSet(valueSet);
  if (expansion === undefined)
    return [
      {
        severity: "warning",
        message: `${where}: binding not checked: the ValueSet ${valueSet} is not loaded`,
      },
    ];
  const bareCode = types.includes("code");
  const findings: BindingFinding[] = [];
  for (const written of codes) {
    const inSet =
      written.system === undefined || bareCode
        ? Object.values(expansion.codes).some((list) => list.includes(written.code))
        : (expansion.codes[written.system] ?? []).includes(written.code);
    if (inSet) continue;
    const code =
      written.system === undefined || bareCode
        ? `"${written.code}"`
        : `${written.system}|${written.code}`;
    findings.push({
      severity: required ? "error" : "warning",
      ...(written.field === undefined ? {} : { field: written.field }),
      message: `${where}: ${code} (${written.from}) is not in the ${binding.strength} ValueSet ${valueSet}`,
    });
  }
  return findings;
}
