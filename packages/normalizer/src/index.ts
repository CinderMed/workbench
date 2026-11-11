/** Reference normalizer for tabular source rows (normalization.schema.json 1.2.0). */
export const packageName = "@cindermed/normalizer";

export { CsvReader, parseCsv, type CsvOptions } from "./csv.js";
export { createDecoder, decodeInput, type Decoder, type InputSettings } from "./decode.js";
export { computeId, hashHex, type HashKey } from "./ids.js";
export {
  normalizeRow,
  resolveHashKey,
  type CellValue,
  type IssueKind,
  type NormalizationIssue,
  type NormalizeOptions,
  type NormalizeResult,
  type NormalizedRow,
  type NormalizedValue,
  type NumberText,
  type RowContext,
  type RowOutcome,
} from "./normalize.js";
export { serializeRowNdjson, serializeRows } from "./serialize.js";
export {
  createNormalizer,
  inputSettings,
  normalize,
  normalizeStream,
  type Normalizer,
  type NormalizerEvent,
} from "./stream.js";
