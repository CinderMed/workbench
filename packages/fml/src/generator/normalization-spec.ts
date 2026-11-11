/**
 * Normalization specification of a table (normalization.schema.json 1.1.0): how the conversion
 * module turns each CSV row into the normalized row the logical model describes. It is derived
 * from the column dictionary (`dateFormat`, `decimalSeparator`, `missingValues`, `multiValue`,
 * `originalName`), the roles' `idRule` and `project.output.onInvalidValue`, as in the verified
 * examples (fixtures/fml-examples/*\/normalization-*.json).
 *
 * Locale handling is declared at the border (ADR-0009): inside the platform values are canonical
 * (ISO dates, `.` decimals, true/false). `input` (delimiter, quote, encoding, header row) describes
 * the data file, not the mapping, so it keeps the schema defaults and the conversion module
 * overrides it at run time.
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

/** Default of `project.output.onInvalidValue` (project schema 1.3.0): stop at the first invalid value. */
export const DEFAULT_ON_INVALID_VALUE = "fail";

function columnSpec({ column, element }: PlannedColumn): Normalization.Column {
  const spec: Normalization.Column = {
    name: element,
    sourceName: column.originalName ?? column.name,
    type: ELEMENT_TYPE[column.dataType],
  };
  if (column.dateFormat !== undefined) spec.dateFormat = column.dateFormat;
  if (column.decimalSeparator !== undefined) spec.decimalSeparator = column.decimalSeparator;
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
    onInvalidValue: project.project.output?.onInvalidValue ?? DEFAULT_ON_INVALID_VALUE,
    columns: plan.columns.map(columnSpec) as NormalizationSpec["columns"],
    ids: plan.idFields.map(idFieldSpec),
    hash: { algorithm: "sha256" },
  };
}
