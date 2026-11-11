/**
 * Deterministic ids (normalization.schema.json, `IdField`; specification step 6): the literals,
 * then the encoded column values, joined by the separator (default `-`).
 *
 * - `hash`: SHA-256 over the canonical values joined by U+001F, as lower-case hex, cut to
 *   `hashLength` characters (default 24). With `hash.keyId` it is HMAC-SHA256 with a key kept
 *   outside the package (@noble/hashes, ADR-0010).
 * - `sanitize`: the values joined by the separator, every character outside `[A-Za-z0-9.-]`
 *   replaced by `-`.
 */
import type { Normalization } from "@cindermed/model";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** HMAC key: raw bytes, or text encoded as UTF-8. */
export type HashKey = Uint8Array | string;

const DEFAULT_HASH_LENGTH = 24;

/** Lower-case hex SHA-256 (or HMAC-SHA256 with `key`) of a UTF-8 text. */
export function hashHex(text: string, key?: HashKey): string {
  const data = utf8ToBytes(text);
  if (key === undefined) return bytesToHex(sha256(data));
  return bytesToHex(hmac(sha256, typeof key === "string" ? utf8ToBytes(key) : key, data));
}

/** The id of one row, from the canonical values of the id field's columns, in order. */
export function computeId(
  idField: Normalization.IdField,
  values: readonly string[],
  key?: HashKey,
): string {
  const separator = idField.separator ?? "-";
  const tail =
    idField.encoding === "hash"
      ? hashHex(values.join("\u001f"), key).slice(0, idField.hashLength ?? DEFAULT_HASH_LENGTH)
      : values.join(separator).replace(/[^A-Za-z0-9.-]/g, "-");
  return [...idField.literals.filter((literal) => literal !== ""), tail].join(separator);
}
