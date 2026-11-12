/**
 * Reading settings of the data file and decoding of its bytes (normalization.schema.json 1.2.0,
 * `input`). Decoding follows the WHATWG Encoding Standard (ADR-0010): `iso-8859-1` is windows-1252,
 * so 0x80 is `€`; UTF-8 drops a leading byte order mark. Bytes may come in chunks: a character split
 * across two chunks is decoded once both have arrived.
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

/** Turns chunks of bytes (or text) into text, in order. */
export interface Decoder {
  push(chunk: string | Uint8Array): string;
  end(): string;
}

/**
 * A streaming decoder for one file. Text chunks are used as they are; byte chunks are decoded with
 * the file's encoding. A leading byte order mark (U+FEFF) is dropped from the start of the file.
 */
export function createDecoder(encoding: InputSettings["encoding"]): Decoder {
  const decoder = new TextDecoder(encoding === "utf-8-bom" ? "utf-8" : encoding);
  let started = false;
  const strip = (text: string): string => {
    if (started || text === "") return text;
    started = true;
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
  };
  return {
    push: (chunk) =>
      strip(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })),
    end: () => strip(decoder.decode()),
  };
}

/** Text of a whole data file (see `createDecoder`). */
export function decodeInput(
  input: string | Uint8Array,
  encoding: InputSettings["encoding"],
): string {
  const decoder = createDecoder(encoding);
  return decoder.push(input) + decoder.end();
}
