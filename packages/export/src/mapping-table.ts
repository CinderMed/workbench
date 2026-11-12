/**
 * The mapping table (H1): a flat view of a project for documentation and review, in the style of
 * Table 1 of the MOTU paper. Four sheets of text cells: Mapping (one line per mapping row), Value
 * maps (one line per entry of every value map, boolean ones included, with its action), Roles and
 * Columns. It holds review statuses and notes, never reviewer identities, comments or provenance.
 * The writers (`toCsv`, `toXlsx`) turn the sheets into files.
 */
import { conditionText, roleCondition, type ColumnNames, type Identifier } from "@cindermed/fml";
import type {
  Coding,
  Column,
  Condition,
  FhirValue,
  Id,
  Instance,
  MappingRow,
  ProjectFile,
  SetElement,
  ValueMapEntry,
} from "@cindermed/model";

export interface Sheet {
  readonly name: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const role = (instance: Instance): string =>
  `${instance.resourceType}[${String(instance.index)}]${instance.label === undefined ? "" : ` · ${instance.label}`}`;

const coding = (c: Coding): string =>
  `${c.system}|${c.code}${c.version === undefined ? "" : `|${c.version}`}${c.display === undefined ? "" : ` (${c.display})`}`;

/** A FHIR value in words: `final`, `http://snomed.info/sct|38082009 (display)`, `1.5 mg`. */
function value(v: FhirValue): string {
  switch (v.type) {
    case "Coding":
    case "CodeableConcept":
      return `${coding(v.coding)}${v.type === "CodeableConcept" && v.text !== undefined ? ` "${v.text}"` : ""}`;
    case "Quantity":
      return `${v.value === undefined ? "" : `${String(v.value)} `}${coding(v.unit)}`.trim();
    default:
      return String(v.value);
  }
}

const verification = (v: FhirValue): string =>
  v.type === "Coding" || v.type === "CodeableConcept"
    ? (v.coding.verification?.status ?? "")
    : v.type === "Quantity"
      ? (v.unit.verification?.status ?? "")
      : "";

const setText = (set: readonly SetElement[]): string =>
  set.map((s) => `${s.path} = ${value(s.value)}`).join("; ");

function actionDetail(entry: ValueMapEntry): string {
  const action = entry.action;
  if (action.kind === "setElement") return `set: ${setText(action.set)}`;
  if (action.kind === "use" && action.also !== undefined) return `also: ${setText(action.also)}`;
  return "";
}

/** How an id that points to nothing is written: the table must stay readable on a broken project. */
export const unknown = (kind: string, id: string): string => `unknown ${kind} ${id}`;

interface ColumnName {
  readonly element: Identifier;
  readonly name: string;
}

/**
 * Column names for the condition texts. A condition may name a column that does not exist (the
 * table is written even for projects with integrity errors): it reads "unknown column <id>".
 */
class ColumnNamesOrUnknown extends Map<Id, ColumnName> {
  override get(id: Id): ColumnName {
    const name = unknown("column", id);
    return super.get(id) ?? { element: id as Identifier, name };
  }
}

/** Columns of every table, by id, with their table, and the names the condition texts use. */
function columnIndex(project: ProjectFile) {
  const byId = new Map<Id, { column: Column; table: string }>();
  const names = new ColumnNamesOrUnknown();
  for (const source of project.sources) {
    for (const column of source.columns) {
      byId.set(column.id, { column, table: source.name });
      names.set(column.id, { element: column.name as Identifier, name: column.name });
    }
  }
  return { byId, names: names as ColumnNames };
}

/** Columns a condition reads, at any depth. */
function conditionColumns(condition: Condition | undefined): Id[] {
  if (condition === undefined) return [];
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap(conditionColumns);
    case "not":
      return conditionColumns(condition.condition);
    case "expression":
      return [];
    default:
      return [condition.columnId];
  }
}

/** Columns a role reads: its creation condition, id rule and multiplicity. */
function roleColumns(instance: Instance): Id[] {
  const m = instance.multiplicity;
  return [
    ...conditionColumns(instance.createWhen),
    ...(instance.idRule?.parts ?? []).flatMap((p) => ("columnId" in p ? [p.columnId] : [])),
    ...(m.kind === "perGroup" ? m.groupBy : m.kind === "perValue" ? [m.columnId] : []),
  ];
}

/** Columns a row reads: its column, the unit column of a quantity, concatenated columns, its condition. */
function rowColumns(row: MappingRow): Id[] {
  const ids = row.columnId === undefined ? [] : [row.columnId];
  const t = row.transform;
  if (t.kind === "quantity" && t.unitColumnId !== undefined) ids.push(t.unitColumnId);
  if (t.kind === "concat") ids.push(...t.columnIds);
  return [...ids, ...conditionColumns(row.condition)];
}

function transformText(
  project: ProjectFile,
  row: MappingRow,
  columnName: (id: Id) => string,
): string {
  const t = row.transform;
  const mapName = (id: Id) =>
    project.valueMaps.find((m) => m.id === id)?.name ?? unknown("value map", id);
  switch (t.kind) {
    case "copy":
      return "copy";
    case "cast":
      return `cast to ${t.to}${t.inputFormat === undefined ? "" : ` (from ${t.inputFormat})`}`;
    case "constant":
      return `constant ${value(t.value)}`;
    case "valueMap":
      return `value map ${mapName(t.valueMapId)}`;
    case "quantity":
      if (t.unit !== undefined) return `quantity, unit ${coding(t.unit)}`;
      return `quantity, unit from ${t.unitColumnId === undefined ? "?" : columnName(t.unitColumnId)}${t.unitValueMapId === undefined ? "" : ` (value map ${mapName(t.unitValueMapId)})`}`;
    case "concat":
      return `concatenation of ${t.columnIds.map(columnName).join(", ")}${t.separator === undefined ? "" : ` with '${t.separator}'`}`;
    case "reference": {
      const target = project.instances.find((i) => i.id === t.targetInstanceId);
      const via = t.via === undefined ? "" : ` via ${t.via}`;
      return `reference to ${target === undefined ? unknown("role", t.targetInstanceId) : role(target)}${via}${t.auto === true ? " (automatic)" : ""}`;
    }
    case "expression":
      return `expression (${t.language})`;
  }
}

/** The four sheets of the mapping table. */
export function mappingTables(project: ProjectFile): Sheet[] {
  const { byId, names } = columnIndex(project);
  const columnName = (id: Id) => byId.get(id)?.column.name ?? unknown("column", id);
  const instances = new Map(project.instances.map((i) => [i.id, i]));
  const tableOf = (instance: Instance | undefined) =>
    instance === undefined
      ? ""
      : (project.sources.find((s) => s.id === instance.sourceId)?.name ??
        unknown("table", instance.sourceId));
  const usedBy = (predicate: (row: MappingRow) => boolean) =>
    project.mappings
      .filter(predicate)
      .map((row) => row.code)
      .join(", ");

  const mapping: Sheet = {
    name: "Mapping",
    header: [
      "Code",
      "Table",
      "Column",
      "Column label",
      "Column type",
      "Role",
      "Element",
      "Transform",
      "Condition",
      "Repeat",
      "Notes",
      "Review status",
    ],
    rows: project.mappings.map((row) => {
      const instance = instances.get(row.instanceId);
      const column = row.columnId === undefined ? undefined : byId.get(row.columnId)?.column;
      return [
        row.code,
        tableOf(instance),
        row.columnId === undefined ? "" : (column?.name ?? unknown("column", row.columnId)),
        column?.label ?? "",
        column?.dataType ?? "",
        instance === undefined ? unknown("role", row.instanceId) : role(instance),
        row.path,
        transformText(project, row, columnName),
        row.condition === undefined ? "" : conditionText(row.condition, names),
        row.repeat?.kind ?? "",
        row.notes ?? "",
        row.review?.status ?? "",
      ];
    }),
  };

  const valueMaps: Sheet = {
    name: "Value maps",
    header: [
      "Map",
      "Target type",
      "Source value",
      "Source label",
      "Target system",
      "Target code or value",
      "Target display",
      "Verification",
      "Action",
      "Action detail",
      "Used by",
    ],
    rows: project.valueMaps.flatMap((map) => {
      const used = usedBy(
        (row) =>
          (row.transform.kind === "valueMap" && row.transform.valueMapId === map.id) ||
          (row.transform.kind === "quantity" && row.transform.unitValueMapId === map.id),
      );
      return map.entries.map((entry) => {
        const target = entry.target;
        const isValue = target !== undefined && "value" in target;
        return [
          map.name,
          map.target,
          entry.sourceValue,
          entry.sourceLabel ?? "",
          target === undefined || isValue ? "" : target.system,
          target === undefined ? "" : isValue ? String(target.value) : target.code,
          target === undefined || isValue ? "" : (target.display ?? ""),
          target === undefined || isValue ? "" : (target.verification?.status ?? ""),
          entry.action.kind,
          actionDetail(entry),
          used,
        ];
      });
    }),
  };

  const roles: Sheet = {
    name: "Roles",
    header: [
      "Role",
      "Table",
      "Description",
      "Multiplicity",
      "Created when",
      "Id rule",
      "Fixed values",
      "Fixed values verification",
      "Review status",
    ],
    rows: project.instances.map((instance) => {
      const m = instance.multiplicity;
      const multiplicity =
        m.kind === "perGroup"
          ? `perGroup by ${m.groupBy.map(columnName).join(", ")}`
          : m.kind === "perValue"
            ? `perValue of ${columnName(m.columnId)}`
            : m.kind;
      const condition = roleCondition(project, instance, names, []);
      const rule = instance.idRule;
      const idRule =
        rule === undefined
          ? ""
          : `${rule.parts.map((p) => ("literal" in p ? `'${p.literal}'` : columnName(p.columnId))).join(" + ")} (${rule.encoding ?? "hash"})`;
      const fixed = instance.fixedValues ?? [];
      return [
        role(instance),
        tableOf(instance),
        instance.description ?? "",
        multiplicity,
        condition === undefined ? "always" : condition.text,
        idRule,
        fixed.map((f) => `${f.path} = ${value(f.value)}`).join("; "),
        fixed
          .filter(
            (f) =>
              verification(f.value) !== "" ||
              f.value.type === "Coding" ||
              f.value.type === "CodeableConcept",
          )
          .map((f) => `${f.path}: ${verification(f.value) || "not checked"}`)
          .join("; "),
        instance.review?.status ?? "",
      ];
    }),
  };

  const columns: Sheet = {
    name: "Columns",
    header: [
      "Table",
      "Name",
      "Original name",
      "Label",
      "Description",
      "Type",
      "Format",
      "Allowed values",
      "Missing values",
      "Used by",
      "Review status",
    ],
    rows: project.sources.flatMap((source) =>
      source.columns.map((column) => {
        const format = [
          column.dateFormat === undefined ? "" : `date ${column.dateFormat}`,
          column.decimalSeparator === undefined
            ? ""
            : `decimal separator '${column.decimalSeparator}'`,
          column.multiValue === undefined
            ? ""
            : column.multiValue.encoding === "delimited"
              ? `multiple values separated by '${column.multiValue.separator}'`
              : "multiple values in several columns",
        ].filter((part) => part !== "");
        return [
          source.name,
          column.name,
          column.originalName ?? "",
          column.label ?? "",
          column.description ?? "",
          column.dataType,
          format.join("; "),
          (column.allowedValues ?? [])
            .map((a) => (a.label === undefined ? a.code : `${a.code} (${a.label})`))
            .join("; "),
          (column.missingValues ?? []).join("; "),
          [
            usedBy((row) => rowColumns(row).includes(column.id)),
            ...project.instances.filter((i) => roleColumns(i).includes(column.id)).map(role),
          ]
            .filter((part) => part !== "")
            .join(", "),
          column.review?.status ?? "",
        ];
      }),
    ),
  };

  return [mapping, valueMaps, roles, columns];
}
