/**
 * Lookup tables over a schema-valid project, shared by the integrity rules.
 * Rules must tolerate dangling references (rule 1 reports them): every lookup can miss.
 */
import type {
  Column,
  Condition,
  Instance,
  MappingRow,
  ProjectFile,
  Review,
  Source,
  SourceRelation,
  ValueMap,
} from "../generated/project.js";
import type { ObjectKind } from "../validation-result.js";

/** Kinds of objects that carry an internal id and can be the target of an `…Id` field. */
export type IdKind =
  | "project"
  | "source"
  | "section"
  | "column"
  | "sourceRelation"
  | "instance"
  | "slice"
  | "mapping"
  | "valueMap"
  | "template"
  | "templateApplication"
  | "comment";

/** The top-level object a result is reported on (the grid highlights it). */
export interface Owner {
  objectKind: ObjectKind;
  id: string;
}

/** An object with an internal id, wherever it sits in the file. */
export interface IdEntry {
  kind: IdKind;
  owner: Owner;
  /** Field of the owner that holds the id, e.g. `id` or `slices.0.id`. */
  field: string;
  /** Table that owns the object, for sections and columns. */
  sourceId?: string;
}

/** An `…Id` field that points to another object. */
export interface Reference {
  owner: Owner;
  field: string;
  targetId: string;
  expected: IdKind;
  /** For columns and sections: the table the target must belong to (rule 3). */
  sourceId?: string;
}

export interface ProjectIndex {
  project: ProjectFile;
  ids: Map<string, IdEntry[]>;
  references: Reference[];
  sources: Map<string, Source>;
  /** Columns by id, with the id of their table. */
  columns: Map<string, { column: Column; sourceId: string }>;
  relations: Map<string, SourceRelation>;
  instances: Map<string, Instance>;
  valueMaps: Map<string, ValueMap>;
}

function firstById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
}

/** Column ids used by a condition, with their field path relative to the condition. */
export function conditionColumns(
  condition: Condition,
  field: string,
): { columnId: string; field: string }[] {
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap((inner, i) =>
        conditionColumns(inner, `${field}.conditions.${String(i)}`),
      );
    case "not":
      return conditionColumns(condition.condition, `${field}.condition`);
    case "expression":
      return [];
    default:
      return [{ columnId: condition.columnId, field: `${field}.columnId` }];
  }
}

/** Column ids a mapping row reads, with their field paths. */
export function rowColumns(row: MappingRow): { columnId: string; field: string }[] {
  const columns: { columnId: string; field: string }[] = [];
  if (row.columnId !== undefined) columns.push({ columnId: row.columnId, field: "columnId" });
  const transform = row.transform;
  if (transform.kind === "quantity" && transform.unitColumnId !== undefined) {
    columns.push({ columnId: transform.unitColumnId, field: "transform.unitColumnId" });
  }
  if (transform.kind === "concat") {
    transform.columnIds.forEach((columnId, i) => {
      columns.push({ columnId, field: `transform.columnIds.${String(i)}` });
    });
  }
  if (row.condition !== undefined) columns.push(...conditionColumns(row.condition, "condition"));
  return columns;
}

/** Value maps a row uses, each with the column whose values it translates. */
export function rowValueMaps(
  row: MappingRow,
): { valueMapId: string; columnId: string | undefined }[] {
  const transform = row.transform;
  if (transform.kind === "valueMap")
    return [{ valueMapId: transform.valueMapId, columnId: row.columnId }];
  if (transform.kind === "quantity" && transform.unitValueMapId !== undefined) {
    return [{ valueMapId: transform.unitValueMapId, columnId: transform.unitColumnId }];
  }
  return [];
}

/** Column ids a role reads (multiplicity, creation condition, id rule), with their field paths. */
export function instanceColumns(instance: Instance): { columnId: string; field: string }[] {
  const columns: { columnId: string; field: string }[] = [];
  const multiplicity = instance.multiplicity;
  if (multiplicity.kind === "perGroup") {
    multiplicity.groupBy.forEach((columnId, i) => {
      columns.push({ columnId, field: `multiplicity.groupBy.${String(i)}` });
    });
  }
  if (multiplicity.kind === "perValue") {
    columns.push({ columnId: multiplicity.columnId, field: "multiplicity.columnId" });
  }
  if (instance.createWhen !== undefined) {
    columns.push(...conditionColumns(instance.createWhen, "createWhen"));
  }
  instance.idRule?.parts.forEach((part, i) => {
    if ("columnId" in part)
      columns.push({ columnId: part.columnId, field: `idRule.parts.${String(i)}.columnId` });
  });
  return columns;
}

export function buildIndex(project: ProjectFile): ProjectIndex {
  const ids = new Map<string, IdEntry[]>();
  const references: Reference[] = [];
  const columns = new Map<string, { column: Column; sourceId: string }>();

  const addId = (id: string, entry: IdEntry): void => {
    const entries = ids.get(id);
    if (entries === undefined) ids.set(id, [entry]);
    else entries.push(entry);
  };
  const addRef = (reference: Reference): void => {
    references.push(reference);
  };
  const addComments = (owner: Owner, review: Review | undefined): void => {
    review?.comments?.forEach((comment, i) => {
      const field = `review.comments.${String(i)}`;
      addId(comment.id, { kind: "comment", owner, field: `${field}.id` });
      if (comment.replyTo !== undefined) {
        addRef({
          owner,
          field: `${field}.replyTo`,
          targetId: comment.replyTo,
          expected: "comment",
        });
      }
    });
  };

  addId(project.project.id, {
    kind: "project",
    owner: { objectKind: "project", id: project.project.id },
    field: "id",
  });

  for (const source of project.sources) {
    const owner: Owner = { objectKind: "source", id: source.id };
    addId(source.id, { kind: "source", owner, field: "id" });
    source.sections?.forEach((section, i) => {
      addId(section.id, {
        kind: "section",
        owner,
        field: `sections.${String(i)}.id`,
        sourceId: source.id,
      });
    });
    source.rowKey?.forEach((columnId, i) => {
      addRef({
        owner,
        field: `rowKey.${String(i)}`,
        targetId: columnId,
        expected: "column",
        sourceId: source.id,
      });
    });
    for (const column of source.columns) {
      const columnOwner: Owner = { objectKind: "column", id: column.id };
      addId(column.id, { kind: "column", owner: columnOwner, field: "id", sourceId: source.id });
      if (!columns.has(column.id)) columns.set(column.id, { column, sourceId: source.id });
      if (column.sectionId !== undefined) {
        addRef({
          owner: columnOwner,
          field: "sectionId",
          targetId: column.sectionId,
          expected: "section",
          sourceId: source.id,
        });
      }
      addComments(columnOwner, column.review);
    }
  }

  for (const relation of project.sourceRelations ?? []) {
    const owner: Owner = { objectKind: "sourceRelation", id: relation.id };
    addId(relation.id, { kind: "sourceRelation", owner, field: "id" });
    for (const side of ["from", "to"] as const) {
      const set = relation[side];
      addRef({ owner, field: `${side}.sourceId`, targetId: set.sourceId, expected: "source" });
      set.columnIds.forEach((columnId, i) => {
        addRef({
          owner,
          field: `${side}.columnIds.${String(i)}`,
          targetId: columnId,
          expected: "column",
          sourceId: set.sourceId,
        });
      });
    }
  }

  for (const instance of project.instances) {
    const owner: Owner = { objectKind: "instance", id: instance.id };
    addId(instance.id, { kind: "instance", owner, field: "id" });
    addRef({ owner, field: "sourceId", targetId: instance.sourceId, expected: "source" });
    for (const { columnId, field } of instanceColumns(instance)) {
      addRef({ owner, field, targetId: columnId, expected: "column", sourceId: instance.sourceId });
    }
    const context = instance.context;
    if (context?.patientInstanceId !== undefined) {
      addRef({
        owner,
        field: "context.patientInstanceId",
        targetId: context.patientInstanceId,
        expected: "instance",
      });
    }
    if (context?.encounterInstanceId !== undefined) {
      addRef({
        owner,
        field: "context.encounterInstanceId",
        targetId: context.encounterInstanceId,
        expected: "instance",
      });
    }
    instance.slices?.forEach((slice, i) => {
      addId(slice.id, { kind: "slice", owner, field: `slices.${String(i)}.id` });
    });
    if (instance.templateId !== undefined) {
      addRef({ owner, field: "templateId", targetId: instance.templateId, expected: "template" });
    }
    addComments(owner, instance.review);
  }

  const instances = firstById(project.instances);
  for (const row of project.mappings) {
    const owner: Owner = { objectKind: "mapping", id: row.id };
    addId(row.id, { kind: "mapping", owner, field: "id" });
    addRef({ owner, field: "instanceId", targetId: row.instanceId, expected: "instance" });
    // Columns of a row must be in the table of its role (rule 3).
    const roleSource = instances.get(row.instanceId)?.sourceId;
    for (const { columnId, field } of rowColumns(row)) {
      addRef({
        owner,
        field,
        targetId: columnId,
        expected: "column",
        ...(roleSource === undefined ? {} : { sourceId: roleSource }),
      });
    }
    const transform = row.transform;
    if (transform.kind === "valueMap") {
      addRef({
        owner,
        field: "transform.valueMapId",
        targetId: transform.valueMapId,
        expected: "valueMap",
      });
    }
    if (transform.kind === "quantity" && transform.unitValueMapId !== undefined) {
      addRef({
        owner,
        field: "transform.unitValueMapId",
        targetId: transform.unitValueMapId,
        expected: "valueMap",
      });
    }
    if (transform.kind === "reference") {
      addRef({
        owner,
        field: "transform.targetInstanceId",
        targetId: transform.targetInstanceId,
        expected: "instance",
      });
      if (transform.via !== undefined) {
        addRef({
          owner,
          field: "transform.via",
          targetId: transform.via,
          expected: "sourceRelation",
        });
      }
    }
    addComments(owner, row.review);
  }

  for (const valueMap of project.valueMaps) {
    const owner: Owner = { objectKind: "valueMap", id: valueMap.id };
    addId(valueMap.id, { kind: "valueMap", owner, field: "id" });
    addComments(owner, valueMap.review);
  }

  for (const template of project.templates ?? []) {
    const owner: Owner = { objectKind: "template", id: template.id };
    addId(template.id, { kind: "template", owner, field: "id" });
    template.instanceIds.forEach((instanceId, i) => {
      addRef({
        owner,
        field: `instanceIds.${String(i)}`,
        targetId: instanceId,
        expected: "instance",
      });
    });
    template.applications?.forEach((application, i) => {
      addId(application.id, {
        kind: "templateApplication",
        owner,
        field: `applications.${String(i)}.id`,
      });
    });
  }

  return {
    project,
    ids,
    references,
    sources: firstById(project.sources),
    columns,
    relations: firstById(project.sourceRelations ?? []),
    instances,
    valueMaps: firstById(project.valueMaps),
  };
}
