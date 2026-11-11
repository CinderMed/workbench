/**
 * Reading settings of the data file and decoding of its bytes (normalization.schema.json 1.2.0,
 * `input`). Decoding follows the WHATWG Encoding Standard (ADR-0010): `iso-8859-1` is windows-1252,
 * so 0x80 is `€`; UTF-8 drops a leading byte order mark.
 */
import type { NormalizationSpec } from "@cindermed/model";

type Input = NormalizationSpec["input"];

/** The reading settings with their schema defaults applied. */
export interface InputSettings {
  readonly delimiter: string;
  readonly quote: string;
  readonly encoding: NonNullable<Input["encoding"]>;
  readonly headerRow: number;
}

/**
 * Text of the data file: bytes are decoded with the file's encoding, text is used as it is. A
 * leading byte order mark (U+FEFF) is dropped in both cases.
 */
export function decodeInput(
  input: string | Uint8Array,
  encoding: InputSettings["encoding"],
): string {
  const text =
    typeof input === "string"
      ? input
      : new TextDecoder(encoding === "utf-8-bom" ? "utf-8" : encoding).decode(input);
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
