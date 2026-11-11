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
 */
import type {
  FhirValue,
  Id,
  Instance,
  MappingRow,
  ProjectFile,
  ValidationResult,
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
import { GeneratorCode } from "./codes.js";
import {
  conditionExpr,
  hasExpression,
  roleCondition,
  type ColumnNames,
  type RoleCondition,
} from "./conditions.js";
import { logicalModelName, logicalModelUrl } from "./logical-model.js";
import { roleKey, type Planned, type TablePlan } from "./table-plan.js";

const HL7_SD = "http://hl7.org/fhir/StructureDefinition";
const src = ident("src");
const res = ident("res");
const e = ident("e");
const req = ident("req");

export const MAIN_GROUP_COMMENT =
  "Main group: one transaction Bundle per normalized record.\nEach role becomes an entry with PUT on its deterministic id (computed by the normalization).";

/**
 * Choice elements of R4 resources (`value[x]`, `effective[x]`, …): in a path they carry their type
 * (`valueQuantity`), while the FML target is the element name (`value`) and the engine picks the
 * type from the value. Until the FHIR definitions arrive (module 3, D7), only these names are
 * recognised; any other name is written as it is (`birthDate`, `recordedDate`).
 */
const CHOICE_ELEMENTS =
  "value effective onset abatement deceased multipleBirth occurrence performed timing born age serviced collected asNeeded dose rate medication reported product allowed used".split(
    " ",
  );
/** FHIR data types that can follow a choice element name. */
const CHOICE_TYPES =
  "Boolean Canonical Code Date DateTime Decimal Id Instant Integer Markdown Oid PositiveInt String Time UnsignedInt Uri Url Uuid Address Age Annotation Attachment CodeableConcept Coding ContactPoint Count Distance Duration HumanName Identifier Money Period Quantity Range Ratio Reference SampledData Signature Timing".split(
    " ",
  );
const CHOICE = new RegExp(`^(${CHOICE_ELEMENTS.join("|")})(${CHOICE_TYPES.join("|")})$`);

/** Element name as FML writes it: a choice element without its type suffix. */
export function fmlElement(name: string): Identifier {
  return ident(CHOICE.exec(name)?.[1] ?? name);
}

interface Segment {
  readonly name: string;
  readonly slice?: string;
}

function parsePath(path: string): Segment[] | undefined {
  const segments: Segment[] = [];
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

  constructor(
    readonly project: ProjectFile,
    readonly plan: TablePlan,
  ) {
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

  idField(instance: Instance): Identifier {
    const field = this.plan.idFields.find((f) => f.instance.id === instance.id)?.field;
    if (field === undefined)
      throw new Error(`No id field for role ${roleKey(instance)}: plan the table first.`);
    return field;
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
  const write = (owner: Identifier, value: Transform): Target[] => {
    const [first, second] = segments;
    if (first === undefined) return [];
    if (second === undefined)
      return [{ context: owner, element: fmlElement(first.name), transform: value }];
    const p = ident("p");
    return [
      { context: owner, element: fmlElement(first.name), alias: p },
      { context: p, element: fmlElement(second.name), transform: value },
    ];
  };
  switch (transform.kind) {
    case "copy":
    case "cast": {
      const v = ident("v");
      return {
        name,
        source: { context: src, element: g.columnElement(row.columnId), alias: v },
        targets: write(context, { kind: "copy", variable: v }),
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
      return { name, source: { context: src }, targets: write(context, fixed) };
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
          { context, element: fmlElement(first.name), alias: r },
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
            : "value maps and quantities are not supported yet (#11, #12)";
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

/** A guard: `src where (condition) then { rule } "<name>"`. */
function guard(name: string, where: Expr, rule: Rule, comment?: string): Rule {
  return {
    name: ruleName(name),
    ...(comment === undefined ? {} : { comment }),
    source: { context: src, where },
    targets: [],
    then: { kind: "rules", rules: [rule] },
  };
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
    if (fixed.path.includes(".") || fixed.path.includes("[")) {
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
      targets: [{ context: res, element: fmlElement(fixed.path), transform }],
    });
  }

  const rows = g.project.mappings.filter((row) => row.instanceId === instance.id);
  const parsed = new Map(rows.map((row) => [row.id, parsePath(row.path)]));
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
          if (transform === undefined) continue;
          inner.push({
            name: ruleName(`slice-${first.slice}-${discriminator.path}`),
            source: { context: src },
            targets: [{ context: alias, element: fmlElement(discriminator.path), transform }],
          });
        }
      }
      const columns: Identifier[] = [];
      for (const member of block) {
        const leaf = parsed.get(member.id)?.[1];
        if (leaf === undefined) continue;
        const rule = valueRule(g, member, alias, [leaf]);
        if (rule !== undefined) inner.push(rule);
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
        targets: [{ context: res, element: fmlElement(first.name), alias }],
        then: { kind: "rules", rules: inner },
      });
      continue;
    }
    const rule = valueRule(g, row, res, segments);
    if (rule === undefined) continue;
    const { where, comment } = rowGuard(g, row);
    if (where !== undefined) rules.push(guard(`${row.code}-guard`, where, rule, comment));
    else rules.push(comment === undefined ? rule : { ...rule, comment });
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

/** The FML syntax tree of one table, or the generator errors that prevent it. */
export function generateMap(project: ProjectFile, plan: TablePlan): Planned<StructureMapAst> {
  const g = new Generation(project, plan);
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
          mode: "produced" as const,
        })),
      ],
      groups,
    },
  };
}
