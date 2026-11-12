import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** SHA-256 (hex) of the UTF-8 bytes of a text. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Length of a text in UTF-8 bytes. */
export function utf8Length(text: string): number {
  return utf8ToBytes(text).length;
}
