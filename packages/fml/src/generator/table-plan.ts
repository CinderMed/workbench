/**
 * What the generator needs to know about one table before writing any artifact: the element name
 * of each column, and the id fields of the normalized row. The logical model, the normalization
 * specification and the FML of the table all derive from this plan, so they always agree.
 *
 * Id fields (specification, "Translation rules"): one per role created by the table, then one per
 * role in another table referenced by a row of this table (through a `via` relation), in the
 * order the rows appear. The id of a referenced role is computed from the columns of THIS table
 * that the relation pairs with the columns of the target's `idRule`.
 */
import type { Column, Id, Instance, ProjectFile, Source, ValidationResult } from "@cindermed/model";
import { groupName, ident, type GroupName, type Identifier } from "../fml-ast.js";
import { GeneratorCode, GeneratorInputError } from "./codes.js";
import { assignElementName } from "./element-names.js";

export interface PlannedColumn {
  readonly column: Column;
  /** Element name in the logical model, the normalized row and the FML. */
  readonly element: Identifier;
}

export interface PlannedIdField {
  /** `id_<ResourceType><index>`, e.g. `id_Encounter0`. */
  readonly field: Identifier;
  readonly instance: Instance;
  /** True when the role is created by another table and only referenced here. */
  readonly referenced: boolean;
  /** Literal parts of the `idRule`, in order. */
  readonly literals: readonly string[];
  /** Columns of THIS table whose normalized values go into the id, in order (at least one). */
  readonly columns: readonly [PlannedColumn, ...PlannedColumn[]];
  readonly encoding: "hash" | "sanitize";
  readonly hashLength: number;
  readonly separator: string;
}

export interface TablePlan {
  readonly source: Source;
  /** Map name, main group name and the stem of the logical model name (`<name>Row`). */
  readonly name: GroupName;
  readonly columns: readonly PlannedColumn[];
  readonly idFields: readonly PlannedIdField[];
}

export type Planned<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly results: ValidationResult[] };

const DEFAULT_HASH_LENGTH = 24;
const DEFAULT_SEPARATOR = "-";

/** Key of a role, as in the FML and in the id field: `Encounter0`. */
export function roleKey(instance: Instance): string {
  return `${instance.resourceType}${String(instance.index)}`;
}

function idFieldName(instance: Instance): string {
  return `id_${roleKey(instance)}`;
}

function sourceName(source: Source, results: ValidationResult[]): GroupName | undefined {
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(source.name)) return groupName(source.name);
  results.push({
    severity: "error",
    code: GeneratorCode.SOURCE_NAME_NOT_FML_NAME,
    objectKind: "source",
    id: source.id,
    field: "name",
    message: `Table name "${source.name}" names the FML map and its logical model: use only letters and digits, starting with a letter.`,
  });
  return undefined;
}

function checkColumns(source: Source, results: ValidationResult[]): void {
  for (const column of source.columns) {
    if (column.multiValue?.encoding === "expanded") {
      results.push({
        severity: "error",
        code: GeneratorCode.MULTI_VALUE_EXPANDED_UNSUPPORTED,
        objectKind: "column",
        id: column.id,
        field: "multiValue.encoding",
        message: `Column "${column.name}": multiple choices spread over several columns (expanded) are not supported yet (B9, V2).`,
      });
    }
  }
}

/** Roles whose id this table computes: its own roles, then the roles its rows reference elsewhere. */
function rolesNeedingIds(project: ProjectFile, source: Source): Map<Id, Id | undefined> {
  const instances = new Map(project.instances.map((instance) => [instance.id, instance]));
  const needed = new Map<Id, Id | undefined>();
  for (const instance of project.instances) {
    if (instance.sourceId === source.id) needed.set(instance.id, undefined);
  }
  for (const row of project.mappings) {
    const transform = row.transform;
    if (transform.kind !== "reference") continue;
    if (instances.get(row.instanceId)?.sourceId !== source.id) continue;
    if (!needed.has(transform.targetInstanceId))
      needed.set(transform.targetInstanceId, transform.via);
  }
  return needed;
}

function planIdField(
  project: ProjectFile,
  instance: Instance,
  via: Id | undefined,
  referenced: boolean,
  columnsById: ReadonlyMap<Id, PlannedColumn>,
  field: Identifier,
  results: ValidationResult[],
): PlannedIdField | undefined {
  const rule = instance.idRule;
  if (rule === undefined) {
    results.push({
      severity: "error",
      code: GeneratorCode.ROLE_WITHOUT_ID_RULE,
      objectKind: "instance",
      id: instance.id,
      field: "idRule",
      message: `Role ${instance.resourceType}[${String(instance.index)}] has no id rule, so its resource can never be created.`,
    });
    return undefined;
  }
  // Columns of the target role → columns of this table, through the relation.
  const paired = new Map<Id, Id>();
  if (via !== undefined) {
    const relation = (project.sourceRelations ?? []).find((r) => r.id === via);
    if (relation === undefined) throw new GeneratorInputError(`Unknown source relation "${via}".`);
    relation.to.columnIds.forEach((to, i) => {
      const from = relation.from.columnIds[i];
      if (from !== undefined) paired.set(to, from);
    });
  }
  const role = `${instance.resourceType}[${String(instance.index)}]`;
  const literals: string[] = [];
  const columns: PlannedColumn[] = [];
  const errors = results.length;
  for (const [i, part] of rule.parts.entries()) {
    if ("literal" in part) {
      if (columns.length > 0) {
        results.push({
          severity: "error",
          code: GeneratorCode.ID_LITERAL_AFTER_COLUMN,
          objectKind: "instance",
          id: instance.id,
          field: `idRule.parts.${String(i)}`,
          message: `Role ${role}: literal parts of the id rule must come before the column parts.`,
        });
      }
      literals.push(part.literal);
      continue;
    }
    const columnId = paired.get(part.columnId) ?? part.columnId;
    const column = columnsById.get(columnId);
    if (column === undefined) {
      throw new GeneratorInputError(
        `Id column "${part.columnId}" of role ${roleKey(instance)} is not reachable from the table: check the integrity rules first.`,
      );
    }
    columns.push(column);
  }
  const [first, ...rest] = columns;
  if (first === undefined) {
    results.push({
      severity: "error",
      code: GeneratorCode.ID_RULE_WITHOUT_COLUMNS,
      objectKind: "instance",
      id: instance.id,
      field: "idRule.parts",
      message: `Role ${role}: the id rule has no column part, so every row would get the same id.`,
    });
    return undefined;
  }
  if (results.length > errors) return undefined;
  return {
    field,
    instance,
    referenced,
    literals,
    columns: [first, ...rest],
    encoding: rule.encoding ?? "hash",
    hashLength: rule.hashLength ?? DEFAULT_HASH_LENGTH,
    separator: rule.separator ?? DEFAULT_SEPARATOR,
  };
}

/**
 * Plans one table. The project must pass the schema and the integrity rules; features they accept
 * but the generator cannot translate are returned as error results.
 */
export function planTable(project: ProjectFile, sourceId: Id): Planned<TablePlan> {
  const source = project.sources.find((s) => s.id === sourceId);
  if (source === undefined) throw new GeneratorInputError(`Unknown source "${sourceId}".`);
  const results: ValidationResult[] = [];
  const name = sourceName(source, results);
  checkColumns(source, results);

  const instances = new Map(project.instances.map((instance) => [instance.id, instance]));
  const needed = rolesNeedingIds(project, source);
  const idNames = [...needed.keys()].map((instanceId) => {
    const instance = instances.get(instanceId);
    if (instance === undefined) throw new GeneratorInputError(`Unknown role "${instanceId}".`);
    return { instance, field: ident(idFieldName(instance)) };
  });

  // Id field names are fixed by the contract (`id_Type0`): columns give way to them.
  const taken = new Set<string>(idNames.map((entry) => entry.field));
  const columns = source.columns.map((column) => ({
    column,
    element: assignElementName(column.name, taken),
  }));
  const columnsById = new Map(columns.map((planned) => [planned.column.id, planned]));

  const idFields: PlannedIdField[] = [];
  for (const { instance, field } of idNames) {
    const referenced = instance.sourceId !== source.id;
    const via = needed.get(instance.id);
    const planned = planIdField(project, instance, via, referenced, columnsById, field, results);
    if (planned !== undefined) idFields.push(planned);
  }

  if (results.length > 0 || name === undefined) return { ok: false, results };
  return { ok: true, value: { source, name, columns, idFields } };
}
