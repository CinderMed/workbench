/**
 * Cardinality, first version (D7; specification, "Type compatibility in the grid", Cardinality;
 * ADR-0018):
 * - CARDINALITY_MISMATCH (error): a multiple-choice column (several values per record) written
 *   without `repeat: eachValue`;
 * - DUPLICATE_TARGET (warning): two writes to the same single-valued element of a role whose
 *   conditions are not recognised as mutually exclusive. Writes are recognised as exclusive only
 *   when one column is needed differently: with no value by one and a value by the other, or with
 *   disjoint values (`equals`, `in`). A row also needs a value in the column it reads. A full
 *   analysis of conditions comes later, so this is a warning that asks the user to check them.
 */
import type { Column, Condition, Instance, ProjectFile, ValidationResult } from "@cindermed/model";
import type { FhirDefinitions } from "./definitions.js";
import { type ResolvedElement, resolvePath } from "./element-tree.js";

export const CardinalityCode = {
  CARDINALITY_MISMATCH: "CARDINALITY_MISMATCH",
  DUPLICATE_TARGET: "DUPLICATE_TARGET",
} as const;

const repeats = (max: string) => max === "*" || Number(max) > 1;
/** Transforms that read the row's column: the row writes only when the column has a value. */
const READS_COLUMN: ReadonlySet<string> = new Set(["copy", "cast", "valueMap", "quantity"]);

/** One write to an element of a role: a mapping row or a fixed value (always written). */
interface Write {
  readonly label: string;
  readonly objectKind: "mapping" | "instance";
  readonly id: string;
  readonly field: string;
  /** What the write requires of each column (empty for fixed values: always written). */
  readonly needs: ReadonlyMap<string, Requirement>;
}

/**
 * The element a path writes, as the generator sees it: every segment's snapshot element (a choice
 * once, whatever its concrete name) with its slice. Two paths with the same key write the same
 * element of the same repetition.
 */
function targetKey(element: ResolvedElement): string {
  return element.segments
    .map((s) => `${s.elementId}${s.slice === undefined ? "" : `[${s.slice}]`}`)
    .join("/");
}

/** What a write requires of one column: no value, or a value (one of `values`, when given). */
type Requirement =
  { readonly empty: true } | { readonly empty: false; readonly values?: ReadonlySet<string> };

/**
 * What a write requires of each column, from the column it reads (it writes only when that column
 * has a value) and from its condition: `equals`, `in`, `notEmpty` and `empty`, also inside `and`.
 * `or`, `not`, `notEquals`, `notIn` and expressions say nothing that is used here.
 */
export function requirements(
  columnId: string | undefined,
  condition: Condition | undefined,
): Map<string, Requirement> {
  const found = new Map<string, Requirement>();
  const add = (column: string, requirement: Requirement) => {
    const before = found.get(column);
    if (before === undefined || before.empty || requirement.empty) {
      found.set(column, before?.empty === true ? before : requirement);
      return;
    }
    // Both require a value: keep the narrower list.
    const values =
      before.values === undefined
        ? requirement.values
        : requirement.values === undefined
          ? before.values
          : new Set([...before.values].filter((v) => requirement.values?.has(v)));
    found.set(column, values === undefined ? { empty: false } : { empty: false, values });
  };
  if (columnId !== undefined) add(columnId, { empty: false });
  const visit = (c: Condition | undefined): void => {
    if (c === undefined) return;
    if (c.op === "and") c.conditions.forEach(visit);
    else if (c.op === "equals") add(c.columnId, { empty: false, values: new Set([c.value]) });
    else if (c.op === "in") add(c.columnId, { empty: false, values: new Set(c.values) });
    else if (c.op === "notEmpty") add(c.columnId, { empty: false });
    else if (c.op === "empty") add(c.columnId, { empty: true });
  };
  visit(condition);
  return found;
}

/** Whether two writes are recognised as never happening together: one column they need differently. */
export function exclusive(
  a: ReadonlyMap<string, Requirement>,
  b: ReadonlyMap<string, Requirement>,
): boolean {
  for (const [column, left] of a) {
    const right = b.get(column);
    if (right === undefined) continue;
    if (left.empty !== right.empty) return true;
    if (!left.empty && !right.empty && left.values !== undefined && right.values !== undefined)
      if ([...left.values].every((v) => !right.values?.has(v))) return true;
  }
  return false;
}

export function checkCardinality(
  project: ProjectFile,
  defs: FhirDefinitions,
  definitionOf: (instance: Instance) => string | undefined,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const columns = new Map<string, Column>(
    project.sources.flatMap((s) => s.columns.map((c) => [c.id, c] as const)),
  );

  // CARDINALITY_MISMATCH: several values per record, but no repetition per value.
  for (const row of project.mappings) {
    if (
      row.columnId === undefined ||
      row.transform.kind !== "valueMap" ||
      row.repeat?.kind === "eachValue"
    )
      continue;
    const column = columns.get(row.columnId);
    if (column?.dataType !== "multipleChoice") continue;
    results.push({
      severity: "error",
      code: CardinalityCode.CARDINALITY_MISMATCH,
      objectKind: "mapping",
      id: row.id,
      field: "repeat",
      message: `${row.code}: column ${column.name} holds several values per record (multipleChoice), but ${row.path} gets them without repeat eachValue: add repeat eachValue towards a repeating element`,
    });
  }

  // DUPLICATE_TARGET: two writes to one single-valued element of a role.
  for (const instance of project.instances) {
    const ref = definitionOf(instance);
    if (ref === undefined) continue;
    const groups = new Map<string, { element: ResolvedElement; writes: Write[] }>();
    const add = (path: string, write: Write) => {
      const resolved = resolvePath(defs, ref, path);
      if (!resolved.ok || repeats(resolved.value.max)) return; // Path errors: D7; repeating: no clash.
      const key = targetKey(resolved.value);
      const group = groups.get(key) ?? { element: resolved.value, writes: [] };
      group.writes.push(write);
      groups.set(key, group);
    };
    instance.fixedValues?.forEach((fixed, i) => {
      add(fixed.path, {
        label: "fixed value",
        objectKind: "instance",
        id: instance.id,
        field: `fixedValues.${String(i)}.path`,
        needs: new Map(),
      });
    });
    for (const row of project.mappings) {
      if (row.instanceId !== instance.id) continue;
      add(row.path, {
        label: row.code,
        objectKind: "mapping",
        id: row.id,
        field: "path",
        needs: requirements(
          READS_COLUMN.has(row.transform.kind) ? row.columnId : undefined,
          row.condition,
        ),
      });
    }
    for (const { element, writes } of groups.values()) {
      for (const [i, write] of writes.entries()) {
        const clash = writes.slice(0, i).find((earlier) => !exclusive(earlier.needs, write.needs));
        if (clash === undefined) continue;
        results.push({
          severity: "warning",
          code: CardinalityCode.DUPLICATE_TARGET,
          objectKind: write.objectKind,
          id: write.id,
          field: write.field,
          message: `${write.label} and ${clash.label} both write ${instance.resourceType}.${element.path}, which holds one value: check that their conditions are never true together (only conditions on the same column with different values are recognised as exclusive)`,
        });
      }
    }
  }
  return results;
}
