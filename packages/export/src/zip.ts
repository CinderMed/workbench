/**
 * Deterministic zip of the export package (ADR-0012): the same files and `createdAt` always give
 * the same bytes, on any machine. Entries are sorted by path; every entry has the same timestamp
 * (`createdAt`), the same "made by" system (3, Unix), the same attributes (a regular file,
 * permissions 0644) and the same compression level; there are no comments or extra fields.
 */
import { zipSync, type Zippable } from "fflate";

const UNIX = 3;
const REGULAR_FILE_0644 = (0o100644 << 16) >>> 0;
const LEVEL = 9;

/**
 * The ZIP timestamp is written from the local-time fields of a Date. Building the Date from the
 * UTC fields of `createdAt` makes the bytes the same in every time zone.
 */
function zipTime(createdAt: string): Date {
  const utc = new Date(createdAt);
  if (Number.isNaN(utc.getTime())) throw new Error(`createdAt is not a date: "${createdAt}"`);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    utc.getUTCHours(),
    utc.getUTCMinutes(),
    utc.getUTCSeconds(),
  );
}

export function deterministicZip(
  files: ReadonlyMap<string, Uint8Array>,
  createdAt: string,
): Uint8Array {
  const mtime = zipTime(createdAt);
  const entries: Zippable = {};
  for (const path of [...files.keys()].sort()) {
    const data = files.get(path);
    if (data === undefined) continue;
    entries[path] = [data, { mtime, os: UNIX, attrs: REGULAR_FILE_0644, level: LEVEL }];
  }
  return zipSync(entries, { mtime, os: UNIX, attrs: REGULAR_FILE_0644, level: LEVEL });
}
