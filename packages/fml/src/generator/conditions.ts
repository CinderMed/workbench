/**
 * Creation conditions of a role (specification, "Translation rules", creation condition row): the
 * project's `createWhen` as a FHIRPath tree, plus one `.where(…).empty()` clause per value map of
 * the role's rows with `skipInstance` entries, and the same condition in words for the comments.
 *
 * - `notEmpty` → `$this.col.exists()`, `empty` → `($this.col.exists()).not()`;
 * - `equals` / `in` → `$this.col.where($this = 'v' or …).exists()`;
 * - `notEquals` / `notIn` and `skipInstance` values → `$this.col.where(…).empty()`;
 * - `and`, `or`, `not` as they are. A `skipInstance` clause identical to a clause already in
 *   `createWhen` is not repeated.
 */
import type { Condition, Id, Instance, ProjectFile } from "@cindermed/model";
import type { ValidationResult } from "@cindermed/model";
import type { Expr, Identifier } from "../fml-ast.js";
import { GeneratorCode } from "./codes.js";

/** Element name and project name of each column of the table. */
export type ColumnNames = ReadonlyMap<Id, { readonly element: Identifier; readonly name: string }>;

/** A condition as an expression and in words, or `undefined` when the role has none. */
export interface RoleCondition {
  readonly expr: Expr;
  readonly text: string;
}

function column(columns: ColumnNames, id: Id) {
  const found = columns.get(id);
  if (found === undefined)
    throw new Error(`Column "${id}" is not in the table: check the integrity rules first.`);
  return found;
}

const quoted = (value: string): string => `'${value}'`;

function toExpr(condition: Condition, columns: ColumnNames): Expr {
  switch (condition.op) {
    case "notEmpty":
      return { kind: "exists", column: column(columns, condition.columnId).element };
    case "empty":
      return {
        kind: "not",
        arg: { kind: "exists", column: column(columns, condition.columnId).element },
      };
    case "equals":
    case "notEquals":
      return {
        kind: condition.op === "equals" ? "anyOf" : "noneOf",
        column: column(columns, condition.columnId).element,
        values: [condition.value],
      };
    case "in":
    case "notIn":
      return {
        kind: condition.op === "in" ? "anyOf" : "noneOf",
        column: column(columns, condition.columnId).element,
        values: condition.values,
      };
    case "and":
    case "or": {
      const [first, second, ...rest] = condition.conditions;
      return {
        kind: condition.op,
        args: [
          toExpr(first, columns),
          toExpr(second, columns),
          ...rest.map((c) => toExpr(c, columns)),
        ],
      };
    }
    case "not":
      return { kind: "not", arg: toExpr(condition.condition, columns) };
    case "expression":
      throw new Error("expert expressions are rejected before translation");
  }
}

function toText(condition: Condition, columns: ColumnNames, nested = false): string {
  switch (condition.op) {
    case "notEmpty":
      return `${column(columns, condition.columnId).name} is not empty`;
    case "empty":
      return `${column(columns, condition.columnId).name} is empty`;
    case "equals":
      return `${column(columns, condition.columnId).name} = ${quoted(condition.value)}`;
    case "notEquals":
      return `${column(columns, condition.columnId).name} is not ${quoted(condition.value)}`;
    case "in":
    case "notIn": {
      const list = `{${condition.values.map(quoted).join(", ")}}`;
      const verb = condition.op === "in" ? "in" : "not in";
      return `${column(columns, condition.columnId).name} ${verb} ${list}`;
    }
    case "and":
    case "or": {
      const text = condition.conditions
        .map((c) => toText(c, columns, true))
        .join(` ${condition.op} `);
      return nested ? `(${text})` : text;
    }
    case "not":
      return `not (${toText(condition.condition, columns)})`;
    case "expression":
      return "expression";
  }
}

/** Whether a condition (at any depth) uses the expert expression (D6). */
function hasExpression(condition: Condition): boolean {
  if (condition.op === "expression") return true;
  if (condition.op === "and" || condition.op === "or")
    return condition.conditions.some(hasExpression);
  if (condition.op === "not") return hasExpression(condition.condition);
  return false;
}

/**
 * `skipInstance` values of the value maps used by the role's rows, per column, in row order:
 * a row with such a value creates no resource.
 */
function skipClauses(project: ProjectFile, instance: Instance): Condition[] {
  const clauses: Condition[] = [];
  for (const row of project.mappings) {
    if (row.instanceId !== instance.id || row.transform.kind !== "valueMap") continue;
    if (row.columnId === undefined) continue;
    const valueMapId = row.transform.valueMapId;
    const valueMap = project.valueMaps.find((map) => map.id === valueMapId);
    const values = (valueMap?.entries ?? [])
      .filter((entry) => entry.action.kind === "skipInstance")
      .map((entry) => entry.sourceValue);
    const [first, ...rest] = values;
    if (first === undefined) continue;
    clauses.push(
      rest.length === 0
        ? { op: "notEquals", columnId: row.columnId, value: first }
        : { op: "notIn", columnId: row.columnId, values: [first, ...rest] },
    );
  }
  return clauses;
}

const same = (a: Condition, b: Condition): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The creation condition of a role (without the presence of its id, which the caller adds), or
 * `undefined` when the role is always created. An expert expression is a generator error.
 */
export function roleCondition(
  project: ProjectFile,
  instance: Instance,
  columns: ColumnNames,
  results: ValidationResult[],
): RoleCondition | undefined {
  if (instance.createWhen !== undefined && hasExpression(instance.createWhen)) {
    results.push({
      severity: "error",
      code: GeneratorCode.CONDITION_EXPRESSION_UNSUPPORTED,
      objectKind: "instance",
      id: instance.id,
      field: "createWhen",
      message: `Role ${instance.resourceType}[${String(instance.index)}]: expert expressions (D6) are not supported in the MVP.`,
    });
    return undefined;
  }
  const own = instance.createWhen === undefined ? [] : [instance.createWhen];
  const clauses = own[0]?.op === "and" ? own[0].conditions : own;
  const extra = skipClauses(project, instance).filter(
    (skip) => !clauses.some((c) => same(c, skip)),
  );
  const all = [...own, ...extra];
  const [first, second, ...rest] = all;
  if (first === undefined) return undefined;
  const condition: Condition =
    second === undefined
      ? first
      : first.op === "and"
        ? {
            op: "and",
            conditions: [...first.conditions, second, ...rest] as [
              Condition,
              Condition,
              ...Condition[],
            ],
          }
        : { op: "and", conditions: [first, second, ...rest] };
  const skipped = extra.length > 0 ? " (skipInstance)" : "";
  return { expr: toExpr(condition, columns), text: `${toText(condition, columns)}${skipped}` };
}

/** A row condition as an expression (expert expressions are rejected by the caller). */
export function conditionExpr(condition: Condition, columns: ColumnNames): Expr {
  return toExpr(condition, columns);
}

/** A condition in words, as in the map comments (`col is not empty`, `col in {'a', 'b'}`, …). */
export function conditionText(condition: Condition, columns: ColumnNames): string {
  return toText(condition, columns);
}

export { hasExpression };
