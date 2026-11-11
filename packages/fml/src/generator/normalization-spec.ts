/**
 * Normalization specification of a table (normalization.schema.json 1.0.0): how the conversion
 * module turns each CSV row into the normalized row the logical model describes. It is derived
 * from the column dictionary (`dateFormat`, `missingValues`, `multiValue`, `originalName`) and the
 * roles' `idRule`, as in the verified examples (fixtures/fml-examples/*\/normalization-*.json).
 *
 * The data file's own settings are not in the project (the import profile describes the
 * dictionary), so `input` uses the schema defaults; the conversion module may override them.
 */
import {
  NORMALIZATION_FORMAT_VERSION,
  type Normalization,
  type NormalizationSpec,
  type ProjectFile,
} from "@cindermed/model";
import { ELEMENT_TYPE, logicalModelUrl } from "./logical-model.js";
import type { PlannedColumn, PlannedIdField, TablePlan } from "./table-plan.js";

export interface NormalizationSpecOptions {
  /**
   * `$schema` written at the top of the specification. Absent = no `$schema`. The verified
   * examples use `../normalization.schema.json`; the export chooses the value for its package.
   */
  readonly schemaRef?: string;
}

function columnSpec({ column, element }: PlannedColumn): Normalization.Column {
  const spec: Normalization.Column = {
    name: element,
    sourceName: column.originalName ?? column.name,
    type: ELEMENT_TYPE[column.dataType],
  };
  if (column.dateFormat !== undefined) spec.dateFormat = column.dateFormat;
  if (column.missingValues !== undefined) spec.missingValues = [...column.missingValues];
  if (column.multiValue?.encoding === "delimited")
    spec.multiValue = { separator: column.multiValue.separator };
  return spec;
}

function idFieldSpec(idField: PlannedIdField): Normalization.IdField {
  const [first, ...rest] = idField.columns;
  return {
    field: idField.field,
    literals: [...idField.literals],
    columns: [first.element, ...rest.map((column) => column.element)],
    encoding: idField.encoding,
    hashLength: idField.hashLength,
    separator: idField.separator,
  };
}

/** The normalization specification of a table. */
export function normalizationSpec(
  project: ProjectFile,
  plan: TablePlan,
  options: NormalizationSpecOptions = {},
): NormalizationSpec {
  return {
    ...(options.schemaRef === undefined ? {} : { $schema: options.schemaRef }),
    formatVersion: NORMALIZATION_FORMAT_VERSION,
    source: plan.name,
    logicalModel: logicalModelUrl(project, plan),
    input: { format: "csv", delimiter: ",", encoding: "utf-8", headerRow: 1 },
    onInvalidValue: "report-drop",
    columns: plan.columns.map(columnSpec) as NormalizationSpec["columns"],
    ids: plan.idFields.map(idFieldSpec),
    hash: { algorithm: "sha256" },
  };
}
