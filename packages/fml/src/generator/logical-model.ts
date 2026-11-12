/**
 * Logical model of the normalized row (G1): a `logical` StructureDefinition with one element per
 * column and one per id field, the source of the FML map. It follows the verified examples
 * (fixtures/fml-examples/*\/StructureDefinition-*Row.json) element by element.
 */
import type { ColumnType, ProjectFile } from "@cindermed/model";
import type { PlannedColumn, PlannedIdField, TablePlan } from "./table-plan.js";

/** FHIR primitive of each column type in the logical model and in the normalization. */
export const ELEMENT_TYPE: Readonly<
  Record<ColumnType, "string" | "integer" | "decimal" | "date" | "dateTime" | "boolean">
> = {
  string: "string",
  integer: "integer",
  decimal: "decimal",
  date: "date",
  dateTime: "dateTime",
  boolean: "boolean",
  categorical: "string",
  multipleChoice: "string",
};

const MAX_SHORT_LENGTH = 120;

export interface ElementDefinitionJson {
  readonly id: string;
  readonly path: string;
  readonly short?: string;
  readonly definition?: string;
  readonly min: 0;
  readonly max: "1" | "*";
  readonly base: { readonly path: string; readonly min: 0; readonly max: "1" | "*" };
  readonly type?: readonly { readonly code: string }[];
}

export interface LogicalModelJson {
  readonly resourceType: "StructureDefinition";
  readonly id: string;
  readonly url: string;
  readonly version: string;
  readonly name: string;
  readonly title: string;
  readonly status: "draft";
  readonly fhirVersion: string;
  readonly kind: "logical";
  readonly abstract: false;
  readonly type: string;
  readonly baseDefinition: string;
  readonly derivation: "specialization";
  readonly snapshot: { readonly element: readonly ElementDefinitionJson[] };
  readonly differential: { readonly element: readonly ElementDefinitionJson[] };
}

/** Name of the logical model of a table: `<table>Row`. */
export function logicalModelName(plan: TablePlan): string {
  return `${plan.name}Row`;
}

/** Canonical URL of the logical model of a table. */
export function logicalModelUrl(project: ProjectFile, plan: TablePlan): string {
  return `${project.project.canonicalBase}/StructureDefinition/${logicalModelName(plan)}`;
}

function element(
  root: string,
  name: string,
  short: string,
  definition: string,
  max: "1" | "*",
  code: string,
): ElementDefinitionJson {
  const path = `${root}.${name}`;
  return {
    id: path,
    path,
    short,
    definition,
    min: 0,
    max,
    base: { path, min: 0, max },
    type: [{ code }],
  };
}

function nonEmpty(text: string | undefined): string | undefined {
  return text === "" ? undefined : text;
}

function columnElement(
  root: string,
  { column, element: name }: PlannedColumn,
): ElementDefinitionJson {
  const label = nonEmpty(column.label) ?? name;
  return element(
    root,
    name,
    Array.from(label).slice(0, MAX_SHORT_LENGTH).join(""),
    // An empty description or label falls through to the next one, as in the verified examples.
    nonEmpty(column.description) ?? nonEmpty(column.label) ?? name,
    column.dataType === "multipleChoice" ? "*" : "1",
    ELEMENT_TYPE[column.dataType],
  );
}

function idElement(root: string, idField: PlannedIdField): ElementDefinitionJson {
  const { instance } = idField;
  const key = `${instance.resourceType}[${String(instance.index)}]`;
  return element(
    root,
    idField.field,
    `Computed id of ${key}`,
    `Deterministic id of the resource of role ${key}${instance.label === undefined || instance.label === "" ? "" : ` (${instance.label})`}, computed by the normalization.`,
    "1",
    "id",
  );
}

/** The logical StructureDefinition of the normalized row of a table. */
export interface LogicalModelOptions {
  /**
   * `version` of the StructureDefinition: the version of the exported package (#83, ADR-0012).
   * Absent = the project format version, for callers outside an export.
   */
  readonly version?: string;
}

export function logicalModel(
  project: ProjectFile,
  plan: TablePlan,
  options: LogicalModelOptions = {},
): LogicalModelJson {
  const name = logicalModelName(plan);
  const url = logicalModelUrl(project, plan);
  const fhirVersion = project.project.fhirVersion;
  const elements: ElementDefinitionJson[] = [
    {
      id: name,
      path: name,
      // Every element has a non-empty definition (FHIR sdf-3, #120).
      definition: nonEmpty(plan.source.description) ?? `Normalized row of table ${plan.name}`,
      min: 0,
      max: "*",
      base: { path: name, min: 0, max: "*" },
    },
    ...plan.columns.map((column) => columnElement(name, column)),
    ...plan.idFields.map((idField) => idElement(name, idField)),
  ];
  return {
    resourceType: "StructureDefinition",
    id: name,
    url,
    version: options.version ?? project.formatVersion,
    name,
    title: `Normalized row of table ${plan.name}`,
    status: "draft",
    fhirVersion,
    kind: "logical",
    abstract: false,
    type: url,
    baseDefinition: fhirVersion.startsWith("5")
      ? "http://hl7.org/fhir/StructureDefinition/Base"
      : "http://hl7.org/fhir/StructureDefinition/Element",
    derivation: "specialization",
    snapshot: { element: elements },
    differential: { element: elements },
  };
}
