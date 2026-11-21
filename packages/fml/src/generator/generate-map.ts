/**
 * Project → FML syntax tree for one table (specification, "Translation rules"; ADR-0011). The
 * generator builds only tree nodes; the printer writes the text.
 *
 * - One map per table: `uses` of the normalized-row logical model (source), Bundle (target) and
 *   each resource type the table creates (produced); a main group with `bundle.type`.
 * - One entry rule per role, guarded by the presence of its id and its creation condition, with
 *   the id, request and fullUrl rule, then a group per role.
 * - In a role group: fixed values first (`fixed-<path>`), then the rows in project order. Two or
 *   more rows writing the same parent element share one block (`<Role>-<element>`); a single row
 *   writes it inline. A named slice is always a block (`slice-<name>`, discriminator
 *   `slice-<name>-code`). A reference to a conditional role of the same table is guarded by that
 *   role's condition (`<code>-guard`), and so is a row with its own condition.
 * - Value maps and quantities come with the value-map rules (#11, #12); `concat` with #98;
 *   expert expressions are not supported in the MVP.
 * - Element names and choice types come from the FHIR definitions, resolved by the export and
 *   passed as plain data (`WrittenPaths`, ADR-0023). On a choice element, a value whose type is not
 *   the chosen one is written with that type: `res.value = create('string') as x, x.value = v`; a
 *   path through a choice opens it with its type: `res.value = create('Quantity') as p` (#156).
 */
import type {
  Coding,
  FhirValue,
  Id,
  Instance,
  MappingRow,
  ProjectFile,
  SetElement,
  ValidationResult,
  ValueMap,
  ValueMapEntry,
} from "@cindermed/model";
import {
  groupName,
  ident,
  ruleName,
  type Expr,
  type Group,
  type Identifier,
  type Rule,
  type StructureMapAst,
  type Target,
  type Transform,
} from "../fml-ast.js";
import { GeneratorCode, GeneratorInputError } from "./codes.js";
import {
  conditionExpr,
  hasExpression,
  roleCondition,
  type ColumnNames,
  type RoleCondition,
} from "./conditions.js";
import { logicalModelName, logicalModelUrl } from "./logical-model.js";
import { valueRuleNames } from "./rule-names.js";
import { roleKey, type Planned, type TablePlan } from "./table-plan.js";
import { pathKey, type WrittenPaths } from "./written-paths.js";

const HL7_SD = "http://hl7.org/fhir/StructureDefinition";
const src = ident("src");
const res = ident("res");
const e = ident("e");
const req = ident("req");

export const MAIN_GROUP_COMMENT =
  "Main group: one transaction Bundle per normalized record.\nEach role becomes an entry with PUT on its deterministic id (computed by the normalization).";

/** A segment of a project path. */
interface PathSegment {
  readonly name: string;
  readonly slice?: string;
}

/** A segment as written: its FML element and, on a choice element, the chosen type. */
interface Segment extends PathSegment {
  readonly element: Identifier;
  readonly choiceType?: string;
}

function parsePath(path: string): PathSegment[] | undefined {
  const segments: PathSegment[] = [];
  for (const part of path.split(".")) {
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\[([A-Za-z0-9_-]+)\])?$/.exec(part);
    if (match?.[1] === undefined) return undefined;
    segments.push(
      match[2] === undefined ? { name: match[1] } : { name: match[1], slice: match[2] },
    );
  }
  return segments;
}

class Generation {
  readonly results: ValidationResult[] = [];
  readonly columns: ColumnNames;
  readonly conditions = new Map<Id, RoleCondition | undefined>();

  readonly project: ProjectFile;
  readonly plan: TablePlan;
  readonly written: WrittenPaths;

  constructor(project: ProjectFile, plan: TablePlan, written: WrittenPaths) {
    this.project = project;
    this.plan = plan;
    this.written = written;
    this.columns = new Map(
      plan.columns.map((c) => [c.column.id, { element: c.element, name: c.column.name }]),
    );
  }

  error(
    code: GeneratorCode,
    objectKind: "instance" | "mapping",
    id: string,
    field: string,
    message: string,
  ): void {
    this.results.push({ severity: "error", code, objectKind, id, field, message });
  }

  role(instance: Instance): string {
    return `${instance.resourceType}[${String(instance.index)}]`;
  }

  condition(instance: Instance): RoleCondition | undefined {
    if (!this.conditions.has(instance.id)) {
      this.conditions.set(
        instance.id,
        roleCondition(this.project, instance, this.columns, this.results),
      );
    }
    return this.conditions.get(instance.id);
  }

  /** The row whose code starts the rule name (`R-010` for `R-010-unit-1`), for diagnostics. */
  rowIdOf(name: string): string | undefined {
    const rows = this.project.mappings.filter(
      (row) => name === row.code || name.startsWith(`${row.code}-`),
    );
    return rows.sort((a, b) => b.code.length - a.code.length)[0]?.id;
  }

  idField(instance: Instance): Identifier {
    const field = this.plan.idFields.find((f) => f.instance.id === instance.id)?.field;
    if (field === undefined)
      throw new Error(`No id field for role ${roleKey(instance)}: plan the table first.`);
    return field;
  }

  /**
   * The segments of a role's path, as written. `undefined` when the path is not a project path
   * (validation reports it); an error when it was not resolved (the export resolves every path of
   * `pathsToWrite`).
   */
  segments(instance: Instance, path: string): Segment[] | undefined {
    const parsed = parsePath(path);
    if (parsed === undefined) return undefined;
    const written = this.written.get(pathKey(instance.id, path));
    if (written?.length !== parsed.length)
      throw new GeneratorInputError(
        `Path "${path}" of role ${this.role(instance)} was not resolved: pass the written paths of every path in pathsToWrite.`,
      );
    return parsed.map((segment, i) => {
      const { name, choiceType } = written[i] ?? { name: segment.name };
      return {
        ...segment,
        element: ident(name),
        ...(choiceType === undefined ? {} : { choiceType }),
      };
    });
  }

  /** The FHIR type of a column's normalized value, as the HL7 engine reads it. */
  columnType(id: Id | undefined): string | undefined {
    const column = this.plan.columns.find((c) => c.column.id === id)?.column;
    if (column === undefined) return undefined;
    return COLUMN_TYPES[column.dataType];
  }

  columnElement(id: Id | undefined): Identifier {
    const found = id === undefined ? undefined : this.columns.get(id);
    if (found === undefined)
      throw new Error(
        `Column "${String(id)}" is not in the table: check the integrity rules first.`,
      );
    return found.element;
  }
}

/** The FHIR type of each column type's normalized value in the logical model. */
const COLUMN_TYPES: Readonly<Record<string, string>> = {
  string: "string",
  categorical: "string",
  multipleChoice: "string",
  integer: "integer",
  decimal: "decimal",
  boolean: "boolean",
  date: "date",
  dateTime: "dateTime",
};

/** The FHIR type of the value a transform writes, as the HL7 engine reads it. */
function writtenType(value: Transform): string | undefined {
  switch (value.kind) {
    case "literal":
      return typeof value.value === "string"
        ? "string"
        : typeof value.value === "boolean"
          ? "boolean"
          : Number.isInteger(value.value)
            ? "integer"
            : "decimal";
    case "c":
      return "Coding";
    case "cc":
      return "CodeableConcept";
    case "create":
      return String(value.type);
    default:
      return undefined;
  }
}

/**
 * `owner.element = value`. On a choice element, a value whose type is not the chosen one is
 * written with that type, or the HL7 engine would take the value's (#156):
 * `owner.element = create('<type>') as x, x.value = value`.
 */
function assign(
  owner: Identifier,
  segment: Segment,
  value: Transform,
  valueType: string | undefined,
): Target[] {
  const chosen = segment.choiceType;
  if (chosen === undefined || valueType === undefined || valueType === chosen)
    return [{ context: owner, element: segment.element, transform: value }];
  const x = ident("x");
  return [
    {
      context: owner,
      element: segment.element,
      transform: { kind: "create", type: ident(chosen) },
      alias: x,
    },
    { context: x, element: ident("value"), transform: value },
  ];
}

/** `owner.element as alias`; a choice element is created with its chosen type (#156). */
function open(owner: Identifier, segment: Segment, alias: Identifier): Target {
  return segment.choiceType === undefined
    ? { context: owner, element: segment.element, alias }
    : {
        context: owner,
        element: segment.element,
        transform: { kind: "create", type: ident(segment.choiceType) },
        alias,
      };
}

/** A fixed value as an FML transform, or `undefined` when the subset cannot write it. */
function fixedTransform(value: FhirValue): Transform | undefined {
  switch (value.type) {
    case "Coding":
    case "CodeableConcept": {
      if (value.type === "CodeableConcept" && value.text !== undefined) return undefined;
      const { system, code, display } = value.coding;
      const kind = value.type === "Coding" ? "c" : "cc";
      return display === undefined ? { kind, system, code } : { kind, system, code, display };
    }
    case "Quantity":
      return undefined;
    default:
      return { kind: "literal", value: value.value };
  }
}

function idRule(g: Generation, instance: Instance): Rule {
  const type = instance.resourceType;
  const key = roleKey(instance);
  const base = g.project.project.output?.fullUrlBase ?? g.project.project.canonicalBase;
  const evaluate = (prefix: string): Transform => ({
    kind: "evaluate",
    variable: ident("i"),
    expression: { kind: "prefixThis", prefix },
  });
  return {
    name: ruleName(`${key}-id`),
    source: { context: src, element: g.idField(instance), alias: ident("i") },
    targets: [
      { context: res, element: ident("id"), transform: { kind: "copy", variable: ident("i") } },
      {
        context: req,
        element: ident("method"),
        transform: { kind: "literal", value: g.project.project.output?.requestMethod ?? "PUT" },
      },
      { context: req, element: ident("url"), transform: evaluate(`${type}/`) },
      { context: e, element: ident("fullUrl"), transform: evaluate(`${base}/${type}/`) },
    ],
  };
}

function roleEntry(g: Generation, instance: Instance): Rule {
  const key = roleKey(instance);
  const condition = g.condition(instance);
  const idExists: Expr = { kind: "exists", column: g.idField(instance) };
  const label = instance.label === undefined ? "" : ` · ${instance.label}`;
  const when = condition === undefined ? "always" : `created when: ${condition.text}`;
  return {
    name: ruleName(key),
    comment: `${g.role(instance)}${label} — ${when}`,
    source: {
      context: src,
      where: condition === undefined ? idExists : { kind: "and", args: [idExists, condition.expr] },
    },
    targets: [
      { context: ident("bundle"), element: ident("entry"), alias: e },
      {
        context: e,
        element: ident("resource"),
        transform: { kind: "create", type: ident(instance.resourceType) },
        alias: res,
      },
      { context: e, element: ident("request"), alias: req },
    ],
    then: {
      kind: "rules",
      rules: [
        idRule(g, instance),
        {
          name: ruleName(`${key}-body`),
          source: { context: src },
          targets: [],
          then: { kind: "invoke", group: groupName(key), args: [src, res] },
        },
      ],
    },
  };
}

/**
 * The targets writing `value` on one segment (`res.status = v`) or two, the parent inline
 * (`res.period as p, p.start = v`); choice elements with their type (#156).
 */
function writeOn(
  owner: Identifier,
  segments: readonly Segment[],
  value: Transform,
  type: string | undefined,
): Target[] {
  const [first, second] = segments;
  if (first === undefined) return [];
  if (second === undefined) return assign(owner, first, value, type);
  const p = ident("p");
  return [open(owner, first, p), ...assign(p, second, value, type)];
}

/**
 * The rule of one row writing its value on `context`: one segment writes the element, two write
 * the parent inline (`res.period as p, p.start = v`).
 */
function valueRule(
  g: Generation,
  row: MappingRow,
  context: Identifier,
  segments: readonly Segment[],
): Rule | undefined {
  const name = ruleName(row.code);
  const transform = row.transform;
  const write = (owner: Identifier, value: Transform, type: string | undefined): Target[] =>
    writeOn(owner, segments, value, type);
  switch (transform.kind) {
    case "copy":
    case "cast": {
      const v = ident("v");
      return {
        name,
        source: { context: src, element: g.columnElement(row.columnId), alias: v },
        targets: write(
          context,
          { kind: "copy", variable: v },
          // A cast is written as a copy: the engine sees the column's type, not the cast's.
          g.columnType(row.columnId),
        ),
      };
    }
    case "constant": {
      const fixed = fixedTransform(transform.value);
      if (fixed === undefined) {
        g.error(
          GeneratorCode.FIXED_VALUE_UNSUPPORTED,
          "mapping",
          row.id,
          "transform.value",
          `Row ${row.code}: this constant cannot be written in the FML subset (Quantity, or CodeableConcept with text).`,
        );
        return undefined;
      }
      return { name, source: { context: src }, targets: write(context, fixed, writtenType(fixed)) };
    }
    case "reference": {
      const target = g.project.instances.find((i) => i.id === transform.targetInstanceId);
      if (target === undefined)
        throw new Error(
          `Unknown role "${transform.targetInstanceId}": check the integrity rules first.`,
        );
      const t = ident("t");
      const r = ident("r");
      const [first] = segments;
      if (first === undefined || segments.length > 1) {
        g.error(
          GeneratorCode.PATH_UNSUPPORTED,
          "mapping",
          row.id,
          "path",
          `Row ${row.code}: a reference is written on a top-level element only.`,
        );
        return undefined;
      }
      return {
        name,
        source: { context: src, element: g.idField(target), alias: t },
        targets: [
          open(context, first, r),
          {
            context: r,
            element: ident("reference"),
            transform: {
              kind: "evaluate",
              variable: t,
              expression: { kind: "prefixThis", prefix: `${target.resourceType}/` },
            },
          },
        ],
      };
    }
    default: {
      const why =
        transform.kind === "expression"
          ? "expert expressions (D6) are not supported in the MVP"
          : transform.kind === "concat"
            ? "concatenation is not supported yet (#98)"
            : "a Quantity.unit value map is used only by a quantity transform";
      g.error(
        GeneratorCode.TRANSFORM_UNSUPPORTED,
        "mapping",
        row.id,
        "transform.kind",
        `Row ${row.code}: ${why}.`,
      );
      return undefined;
    }
  }
}

/** A guard: `src where (condition) then { rules } "<name>"`. */
function guard(name: string, where: Expr, rules: readonly Rule[], comment?: string): Rule {
  return {
    name: ruleName(name),
    ...(comment === undefined ? {} : { comment }),
    source: { context: src, where },
    targets: [],
    then: { kind: "rules", rules },
  };
}

/** The value a value-map entry writes, as an FML transform, for the map's target type. */
function entryTransform(map: ValueMap, entry: ValueMapEntry): Transform | undefined {
  const target = entry.target;
  if (target === undefined) return undefined;
  if ("value" in target) return { kind: "literal", value: target.value };
  if (map.target === "Coding" || map.target === "CodeableConcept") {
    return fixedTransform({ type: map.target, coding: target });
  }
  return undefined;
}

/** `res.path = value` targets of `setElement` and `use.also` (top-level elements only). */
function setTargets(g: Generation, row: MappingRow, set: readonly SetElement[]): Target[] {
  const targets: Target[] = [];
  const instance = g.project.instances.find((i) => i.id === row.instanceId);
  for (const item of set) {
    const transform = fixedTransform(item.value);
    const segment = instance === undefined ? undefined : g.segments(instance, item.path)?.[0];
    if (
      transform === undefined ||
      segment === undefined ||
      item.path.includes(".") ||
      item.path.includes("[")
    ) {
      g.error(
        GeneratorCode.FIXED_VALUE_UNSUPPORTED,
        "mapping",
        row.id,
        "transform.valueMapId",
        `Row ${row.code}: the value-map action sets "${item.path}", which the FML subset cannot write (top-level elements and simple values only).`,
      );
      continue;
    }
    targets.push(...assign(res, segment, transform, writtenType(transform)));
  }
  return targets;
}

/**
 * One rule per value of a value map: `src.col as v where ($this = 'value') -> <target>`, named with
 * `valueRuleNames` over every entry. `skipInstance` values are part of the role's condition and
 * `absent` values write nothing, so neither gets a rule.
 */
function valueMapRules(
  g: Generation,
  row: MappingRow,
  map: ValueMap,
  columnId: Id | undefined,
  alias: Identifier,
  targetsOf: (entry: ValueMapEntry) => Target[] | undefined,
  prefix = row.code,
): Rule[] {
  const names = valueRuleNames(
    prefix,
    map.entries.map((entry) => entry.sourceValue),
  );
  const rules: Rule[] = [];
  map.entries.forEach((entry, i) => {
    const name = names[i];
    if (
      name === undefined ||
      entry.action.kind === "skipInstance" ||
      entry.action.kind === "absent"
    )
      return;
    let targets: Target[];
    if (entry.action.kind === "setElement") targets = setTargets(g, row, entry.action.set);
    else {
      const own = targetsOf(entry);
      if (own === undefined) {
        g.error(
          GeneratorCode.VALUE_MAP_ENTRY_WITHOUT_TARGET,
          "mapping",
          row.id,
          "transform",
          `Row ${row.code}: value '${entry.sourceValue}' of value map ${map.name} has no target to write.`,
        );
        return;
      }
      targets = [...own, ...setTargets(g, row, entry.action.also ?? [])];
    }
    rules.push({
      name,
      source: {
        context: src,
        element: g.columnElement(columnId),
        alias,
        where: { kind: "thisEquals", value: entry.sourceValue },
      },
      targets,
    });
  });
  return rules;
}

const withComment = (rules: Rule[], comment: string): Rule[] => {
  const [first, ...rest] = rules;
  return first === undefined ? rules : [{ ...first, comment }, ...rest];
};

/** Unit rules of a quantity: a fixed unit, or one rule per value of the unit column's value map. */
function unitRules(g: Generation, row: MappingRow, q: Identifier): Rule[] {
  const transform = row.transform;
  if (transform.kind !== "quantity") return [];
  const unitTargets = (unit: Coding): Target[] => [
    {
      context: q,
      element: ident("unit"),
      transform: { kind: "literal", value: unit.display ?? unit.code },
    },
    { context: q, element: ident("system"), transform: { kind: "literal", value: unit.system } },
    { context: q, element: ident("code"), transform: { kind: "literal", value: unit.code } },
  ];
  if (transform.unit !== undefined) {
    return [
      {
        name: ruleName(`${row.code}-unit`),
        source: { context: src },
        targets: unitTargets(transform.unit),
      },
    ];
  }
  const map = g.project.valueMaps.find((m) => m.id === transform.unitValueMapId);
  if (map === undefined || transform.unitColumnId === undefined) return [];
  const rules = valueMapRules(
    g,
    row,
    map,
    transform.unitColumnId,
    ident("u"),
    (entry) =>
      entry.target === undefined || "value" in entry.target ? undefined : unitTargets(entry.target),
    `${row.code}-unit`,
  );
  const column = g.columns.get(transform.unitColumnId)?.name ?? "";
  return withComment(rules, `${row.code}-unit: unit from column ${column}, value map ${map.name}`);
}

/**
 * The rules of one row on `context`: one rule for most transforms, one per value for a value map,
 * a `create('Quantity')` block with its unit rules for a quantity, and a `create('Coding')` or
 * `create('CodeableConcept')` block for a coding.
 */
function rowRules(
  g: Generation,
  row: MappingRow,
  context: Identifier,
  segments: readonly Segment[],
): Rule[] {
  const transform = row.transform;
  const write = (value: Transform): Target[] =>
    writeOn(context, segments, value, writtenType(value));
  if (transform.kind === "valueMap") {
    const map = g.project.valueMaps.find((m) => m.id === transform.valueMapId);
    if (map === undefined)
      throw new Error(
        `Unknown value map "${transform.valueMapId}": check the integrity rules first.`,
      );
    if (map.target === "Quantity.unit") {
      g.error(
        GeneratorCode.TRANSFORM_UNSUPPORTED,
        "mapping",
        row.id,
        "transform.valueMapId",
        `Row ${row.code}: a Quantity.unit value map is used only by a quantity transform.`,
      );
      return [];
    }
    const repeat =
      row.repeat?.kind === "eachValue"
        ? `${row.code} repeat eachValue: the normalized column is a list; each rule fires for every matching value\n`
        : "";
    return withComment(
      valueMapRules(g, row, map, row.columnId, ident("v"), (entry) => {
        const value = entryTransform(map, entry);
        return value === undefined ? undefined : write(value);
      }),
      `${repeat}${row.code}: value map ${map.name} (one rule per value; ConceptMap exported separately)`,
    );
  }
  if (transform.kind === "quantity") {
    const v = ident("v");
    const q = ident("q");
    // On a choice, the chosen type: Quantity, or a type derived from it (Age, Duration, #156).
    const [target] = write({
      kind: "create",
      type: ident(segments[0]?.choiceType ?? "Quantity"),
    });
    if (target === undefined || segments.length > 1) {
      g.error(
        GeneratorCode.PATH_UNSUPPORTED,
        "mapping",
        row.id,
        "path",
        `Row ${row.code}: a quantity is written on a top-level element only.`,
      );
      return [];
    }
    return [
      {
        name: ruleName(row.code),
        source: { context: src, element: g.columnElement(row.columnId), alias: v },
        targets: [{ ...target, alias: q }],
        then: {
          kind: "rules",
          rules: [
            {
              name: ruleName(`${row.code}-value`),
              source: { context: v },
              targets: [
                { context: q, element: ident("value"), transform: { kind: "copy", variable: v } },
              ],
            },
            ...unitRules(g, row, q),
          ],
        },
      },
    ];
  }
  if (transform.kind === "coding") return codingRules(g, row, segments, write);
  const rule = valueRule(g, row, context, segments);
  return rule === undefined ? [] : [rule];
}

/**
 * Coding from a code column (#106): the column's value is the code of a fixed system. A Coding, or
 * a CodeableConcept with one coding, is created with its type (so a choice element gets the right
 * one), and the display is written only when its column has a value:
 *
 *   src.col as v -> res.code = create('CodeableConcept') as cn then {
 *     v -> cn.coding = create('Coding') as cd then {
 *       v -> cd.system = '<system>', cd.code = v "R-x-code";
 *       src.label as d -> cd.display = d "R-x-display";
 *     } "R-x-coding";
 *   } "R-x";
 */
function codingRules(
  g: Generation,
  row: MappingRow,
  segments: readonly Segment[],
  write: (value: Transform) => Target[],
): Rule[] {
  const transform = row.transform;
  if (transform.kind !== "coding") return [];
  const v = ident("v");
  const cd = ident("cd");
  const [target] = write({ kind: "create", type: ident(transform.as) });
  if (target === undefined || segments.length > 1) {
    g.error(
      GeneratorCode.PATH_UNSUPPORTED,
      "mapping",
      row.id,
      "path",
      `Row ${row.code}: a coding is written on a top-level element only.`,
    );
    return [];
  }
  const inner: Rule[] = [
    {
      name: ruleName(`${row.code}-code`),
      source: { context: v },
      targets: [
        {
          context: cd,
          element: ident("system"),
          transform: { kind: "literal", value: transform.system },
        },
        { context: cd, element: ident("code"), transform: { kind: "copy", variable: v } },
      ],
    },
  ];
  if (transform.displayColumnId !== undefined) {
    const d = ident("d");
    inner.push({
      name: ruleName(`${row.code}-display`),
      source: { context: src, element: g.columnElement(transform.displayColumnId), alias: d },
      targets: [
        { context: cd, element: ident("display"), transform: { kind: "copy", variable: d } },
      ],
    });
  }
  const source = { context: src, element: g.columnElement(row.columnId), alias: v };
  if (transform.as === "Coding")
    return [
      {
        name: ruleName(row.code),
        source,
        targets: [{ ...target, alias: cd }],
        then: { kind: "rules", rules: inner },
      },
    ];
  const cn = ident("cn");
  return [
    {
      name: ruleName(row.code),
      source,
      targets: [{ ...target, alias: cn }],
      then: {
        kind: "rules",
        rules: [
          {
            name: ruleName(`${row.code}-coding`),
            source: { context: v },
            targets: [
              {
                context: cn,
                element: ident("coding"),
                transform: { kind: "create", type: ident("Coding") },
                alias: cd,
              },
            ],
            then: { kind: "rules", rules: inner },
          },
        ],
      },
    },
  ];
}

/** The condition that guards a row: its own condition and, for a reference, the target's. */
function rowGuard(g: Generation, row: MappingRow): { where?: Expr; comment?: string } {
  const parts: Expr[] = [];
  let comment: string | undefined;
  const transform = row.transform;
  if (transform.kind === "reference") {
    const target = g.project.instances.find((i) => i.id === transform.targetInstanceId);
    if (target?.sourceId === g.plan.source.id) {
      const condition = g.condition(target);
      if (condition !== undefined) {
        parts.push(condition.expr);
        comment = `${row.code} the reference honours the creation condition of ${g.role(target)}`;
      }
    } else if (target !== undefined && transform.via !== undefined) {
      comment = `${row.code} reference to ${g.role(target)} in another table (via ${transform.via}): the resource must already be loaded`;
    }
  }
  if (row.condition !== undefined) parts.push(conditionExpr(row.condition, g.columns));
  const [first, second, ...rest] = parts;
  const where: Expr | undefined =
    first === undefined
      ? undefined
      : second === undefined
        ? first
        : { kind: "and", args: [first, second, ...rest] };
  return {
    ...(where === undefined ? {} : { where }),
    ...(comment === undefined ? {} : { comment }),
  };
}

function roleGroup(g: Generation, instance: Instance): Group {
  const key = roleKey(instance);
  const rules: Rule[] = [];
  for (const fixed of instance.fixedValues ?? []) {
    const transform = fixedTransform(fixed.value);
    const segment = g.segments(instance, fixed.path)?.[0];
    if (segment === undefined || fixed.path.includes(".") || fixed.path.includes("[")) {
      g.error(
        GeneratorCode.PATH_UNSUPPORTED,
        "instance",
        instance.id,
        "fixedValues",
        `Role ${g.role(instance)}: fixed value on "${fixed.path}": only top-level elements are supported.`,
      );
      continue;
    }
    if (transform === undefined) {
      g.error(
        GeneratorCode.FIXED_VALUE_UNSUPPORTED,
        "instance",
        instance.id,
        "fixedValues",
        `Role ${g.role(instance)}: the fixed value of "${fixed.path}" cannot be written in the FML subset.`,
      );
      continue;
    }
    rules.push({
      name: ruleName(`fixed-${fixed.path}`),
      source: { context: src },
      targets: assign(res, segment, transform, writtenType(transform)),
    });
  }

  const rows = g.project.mappings.filter((row) => row.instanceId === instance.id);
  const parsed = new Map(rows.map((row) => [row.id, g.segments(instance, row.path)]));
  const parentOf = (row: MappingRow): string | undefined => {
    const segments = parsed.get(row.id);
    if (segments === undefined || segments.length < 2) return undefined;
    const [first] = segments;
    return first?.slice === undefined ? first?.name : `${first.name}[${first.slice}]`;
  };
  const sharing = new Map<string, MappingRow[]>();
  for (const row of rows) {
    const parent = parentOf(row);
    if (parent !== undefined) sharing.set(parent, [...(sharing.get(parent) ?? []), row]);
  }
  const done = new Set<string>();

  for (const row of rows) {
    if (row.condition !== undefined && hasExpression(row.condition)) {
      g.error(
        GeneratorCode.CONDITION_EXPRESSION_UNSUPPORTED,
        "mapping",
        row.id,
        "condition",
        `Row ${row.code}: expert expressions (D6) are not supported in the MVP.`,
      );
      continue;
    }
    const segments = parsed.get(row.id);
    if (segments === undefined || segments.length > 2 || segments[1]?.slice !== undefined) {
      g.error(
        GeneratorCode.PATH_UNSUPPORTED,
        "mapping",
        row.id,
        "path",
        `Row ${row.code}: path "${row.path}" has more than two levels or a slice below the first level.`,
      );
      continue;
    }
    const parent = parentOf(row);
    const block = parent === undefined ? undefined : sharing.get(parent);
    const [first, second] = segments;
    if (
      block !== undefined &&
      first !== undefined &&
      second !== undefined &&
      (block.length > 1 || first.slice !== undefined)
    ) {
      if (parent === undefined || done.has(parent)) continue;
      done.add(parent);
      const alias = ident(first.slice === undefined ? "p" : "slc");
      const inner: Rule[] = [];
      if (first.slice !== undefined) {
        const slice = (instance.slices ?? []).find(
          (s) => s.path === first.name && s.name === first.slice,
        );
        for (const discriminator of slice?.discriminator ?? []) {
          const transform = fixedTransform(discriminator.value);
          const element = g
            .segments(instance, `${first.name}[${first.slice}].${discriminator.path}`)
            ?.at(-1);
          if (transform === undefined || element === undefined) continue;
          inner.push({
            name: ruleName(`slice-${first.slice}-${discriminator.path}`),
            source: { context: src },
            targets: assign(alias, element, transform, writtenType(transform)),
          });
        }
      }
      const columns: Identifier[] = [];
      for (const member of block) {
        const leaf = parsed.get(member.id)?.[1];
        if (leaf === undefined) continue;
        inner.push(...rowRules(g, member, alias, [leaf]));
        if (member.columnId !== undefined) {
          const element = g.columnElement(member.columnId);
          if (!columns.includes(element)) columns.push(element);
        }
      }
      const exists = columns.map((column): Expr => ({ kind: "exists", column }));
      const [a, b, ...more] = exists;
      const where: Expr | undefined =
        a === undefined ? undefined : b === undefined ? a : { kind: "or", args: [a, b, ...more] };
      const codes = block.map((member) => member.code).join(", ");
      rules.push({
        name: ruleName(first.slice === undefined ? `${key}-${first.name}` : `slice-${first.slice}`),
        comment:
          first.slice === undefined
            ? `${first.name}: written by ${String(block.length)} rows (${codes}) → one shared instance`
            : `${first.name}[${first.slice}]: named slice, created only if the column has a value`,
        source: where === undefined ? { context: src } : { context: src, where },
        targets: [open(res, first, alias)],
        then: { kind: "rules", rules: inner },
      });
      continue;
    }
    const own = rowRules(g, row, res, segments);
    if (own.length === 0) continue;
    const { where, comment } = rowGuard(g, row);
    if (where !== undefined) rules.push(guard(`${row.code}-guard`, where, own, comment));
    else rules.push(...(comment === undefined ? own : withComment(own, comment)));
  }
  return {
    name: groupName(key),
    params: [
      { mode: "source", name: src, type: ident(logicalModelName(g.plan)) },
      { mode: "target", name: res, type: ident(instance.resourceType) },
    ],
    rules,
  };
}

/**
 * Rule names are unique within a group, nested rules included (#90): diagnostics and the printed
 * line index identify a rule by group and name. Names repeat across groups by design
 * (`fixed-status` in every role group).
 */
function checkRuleNames(g: Generation, group: Group): void {
  const seen = new Set<string>();
  const visit = (rules: readonly Rule[]): void => {
    for (const rule of rules) {
      if (seen.has(rule.name)) {
        g.error(
          GeneratorCode.DUPLICATE_RULE_NAME,
          "mapping",
          g.rowIdOf(rule.name) ?? group.name,
          "code",
          `Group ${group.name}: two rules are named "${rule.name}". Rename a row code or a value so that every rule of the group has its own name.`,
        );
      }
      seen.add(rule.name);
      if (rule.then?.kind === "rules") visit(rule.then.rules);
    }
  };
  visit(group.rules);
}

/** The FML syntax tree of one table, or the generator errors that prevent it. */
export function generateMap(
  project: ProjectFile,
  plan: TablePlan,
  written: WrittenPaths,
): Planned<StructureMapAst> {
  const g = new Generation(project, plan, written);
  const roles = project.instances.filter((instance) => instance.sourceId === plan.source.id);
  for (const instance of roles) {
    if (instance.multiplicity.kind === "perValue") {
      g.error(
        GeneratorCode.MULTIPLICITY_PER_VALUE_UNSUPPORTED,
        "instance",
        instance.id,
        "multiplicity.kind",
        `Role ${g.role(instance)}: one resource per selected value (perValue) is not supported yet.`,
      );
    }
  }
  const types = [...new Set(roles.map((instance) => instance.resourceType))];
  const row = ident(logicalModelName(plan));
  const main: Group = {
    name: plan.name,
    comment: MAIN_GROUP_COMMENT,
    params: [
      { mode: "source", name: src, type: row },
      { mode: "target", name: ident("bundle"), type: ident("Bundle") },
    ],
    rules: [
      {
        name: ruleName("bundle-type"),
        source: { context: src },
        targets: [
          {
            context: ident("bundle"),
            element: ident("type"),
            transform: {
              kind: "literal",
              value: project.project.output?.bundleType ?? "transaction",
            },
          },
        ],
      },
      ...roles.map((instance) => roleEntry(g, instance)),
    ],
  };
  const groups = [main, ...roles.map((instance) => roleGroup(g, instance))];
  for (const group of groups) checkRuleNames(g, group);
  if (g.results.length > 0) return { ok: false, results: g.results };
  return {
    ok: true,
    value: {
      url: `${project.project.canonicalBase}/StructureMap/${plan.name}`,
      name: plan.name,
      uses: [
        { url: logicalModelUrl(project, plan), alias: row, mode: "source" },
        { url: `${HL7_SD}/Bundle`, alias: ident("Bundle"), mode: "target" },
        ...types.map((type) => ({
          url: `${HL7_SD}/${type}`,
          alias: ident(type),
          mode: "target" as const,
        })),
      ],
      groups,
    },
  };
}
