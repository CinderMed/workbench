/** Reference normalizer for tabular source rows (normalization.schema.json 1.2.0). */
export const packageName = "@cindermed/normalizer";

export { parseCsv, type CsvOptions } from "./csv.js";
export { decodeInput, type InputSettings } from "./decode.js";
export { computeId, hashHex, type HashKey } from "./ids.js";
export {
  normalize,
  type CellValue,
  type IssueKind,
  type NormalizationIssue,
  type NormalizeOptions,
  type NormalizeResult,
  type NormalizedRow,
  type NormalizedValue,
  type NumberText,
} from "./normalize.js";
export { serializeRows } from "./serialize.js";
