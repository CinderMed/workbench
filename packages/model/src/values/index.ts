/**
 * Cell parsers shared by the integrity rules and the normalizer (normalization.schema.json 1.2.0).
 *
 * Inside the platform every value has one canonical form: ISO dates, `.` decimals, `true`/`false`.
 * These functions turn the text of one cell into that form, or return `undefined` when the text
 * does not fit the type. They follow the reference normalizer (fixtures/fml-examples/tools/
 * normalize.mjs) exactly, so a value the rules accept is a value the conversion accepts.
 */

/** Step 1 of the normalization: Unicode NFC and removal of outer spaces. */
export function canonicalText(text: string): string {
  return text.normalize("NFC").trim();
}

/** Integer: `^[+-]?[0-9]+$`, written without sign `+` and leading zeros (`+007` → `7`). */
export function parseInteger(text: string): string | undefined {
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  return BigInt(text).toString();
}

export type DecimalSeparator = "." | ",";

/**
 * Decimal with the column's separator, written with `.` and every digit kept (`11,20` → `11.20`):
 * no sign `+`, no leading zeros in the integer part. The separator is strict and there are no
 * thousands separators: with `,` a `.` is invalid (`1.234` is one thousand two hundred thirty-four
 * in Italian data, never 1.234), and with `.` a `,` is invalid.
 */
export function parseDecimal(text: string, separator: DecimalSeparator = "."): string | undefined {
  if (separator === "," && text.includes(".")) return undefined;
  const dotted = separator === "," ? text.replace(",", ".") : text;
  if (!/^[+-]?\d+(\.\d+)?$/.test(dotted)) return undefined;
  return dotted.replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1");
}

/** The only boolean forms a `boolean` column accepts (normalization defaults, case-insensitive). */
export const TRUE_VALUES: readonly string[] = ["1", "true", "yes", "y"];
export const FALSE_VALUES: readonly string[] = ["0", "false", "no", "n"];

/**
 * Boolean in a canonical form: `true`/`false`, `1`/`0`, `yes`/`no`, `y`/`n`, in any case.
 * Words in other languages (`Sì`/`No`) are a categorical column with a value map to boolean.
 */
export function parseBoolean(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (TRUE_VALUES.includes(lower)) return true;
  if (FALSE_VALUES.includes(lower)) return false;
  return undefined;
}

const DATE_TOKENS = ["yyyy", "MM", "dd", "HH", "mm", "ss"] as const;
type DateToken = (typeof DATE_TOKENS)[number];

function isDateToken(token: string): token is DateToken {
  return (DATE_TOKENS as readonly string[]).includes(token);
}

const pad = (n: number, length = 2): string => String(n).padStart(length, "0");

function parseDateText(
  text: string,
  format: string | undefined,
  withTime: boolean,
): string | undefined {
  const pattern = format ?? (withTime ? "yyyy-MM-ddTHH:mm:ss" : "yyyy-MM-dd");
  let source = "";
  const order: DateToken[] = [];
  for (const token of pattern.match(/yyyy|MM|dd|HH|mm|ss|./gu) ?? []) {
    if (isDateToken(token)) {
      source += token === "yyyy" ? "(\\d{4})" : "(\\d{2})";
      order.push(token);
    } else {
      source += token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  const match = new RegExp(`^${source}$`, "u").exec(text);
  if (match === null) return undefined;
  const parts = new Map<DateToken, number>(order.map((token, i) => [token, Number(match[i + 1])]));
  const year = parts.get("yyyy");
  if (year === undefined) return undefined;
  const month = parts.get("MM");
  if (month === undefined) return pad(year, 4); // year only
  if (month < 1 || month > 12) return undefined;
  const day = parts.get("dd");
  if (day === undefined) return `${pad(year, 4)}-${pad(month)}`; // year and month
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined; // e.g. 31/02
  const iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  const hour = parts.get("HH");
  if (!withTime || hour === undefined) return iso;
  const minute = parts.get("mm") ?? 0;
  const second = parts.get("ss") ?? 0;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return `${iso}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * Date according to `dateFormat` (symbols `yyyy`, `MM`, `dd`; every other character matches
 * literally; absent = ISO `yyyy-MM-dd`), with a calendar check (`31/02/2023` is rejected).
 * Written in ISO: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
 */
export function parseDate(text: string, format?: string): string | undefined {
  return parseDateText(text, format, false);
}

/**
 * Date and time according to `dateFormat` (also `HH`, `mm`, `ss`; absent = `yyyy-MM-ddTHH:mm:ss`),
 * written as `YYYY-MM-DDThh:mm:ss` without time zone, or as a date when the format has no time.
 */
export function parseDateTime(text: string, format?: string): string | undefined {
  return parseDateText(text, format, true);
}

/**
 * The offset rules of IANA zones (normalization 1.3.0, `timeZones`): by zone name, the offset at
 * `from`, then pairs of (instant, new offset), in seconds (instants since 1970-01-01T00:00:00Z,
 * offsets east of UTC).
 */
export interface ZoneRules {
  readonly from: number;
  readonly to: number;
  readonly zones: Readonly<Record<string, readonly number[]>>;
}

const FIXED_OFFSET = /^[+-](0[0-9]|1[0-3]):[0-5][0-9]$|^[+-]14:00$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** The offset of a zone at an instant (seconds since 1970-01-01T00:00:00Z). */
function offsetAt(entry: readonly number[], instant: number): number {
  let offset = entry[0] ?? 0;
  // Pairs of (instant, offset) after the first item, in increasing order.
  let lo = 0;
  let hi = (entry.length - 1) / 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((entry[1 + 2 * mid] ?? 0) <= instant) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) offset = entry[2 * lo] ?? offset;
  return offset;
}

/** `+01:00` for 3600 seconds; `+00:00` for 0. */
function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? "-" : "+";
  const minutes = Math.abs(seconds) / 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * A local date and time (`YYYY-MM-DDThh:mm:ss`, as `parseDateTime` writes it) with the offset of a
 * time zone (normalization 1.3.0, ADR-0024): a fixed offset (`+01:00`; `Z` gives `+00:00`), or an
 * IANA zone of `rules`, whose offset at that local time is used. `undefined` (an invalid value)
 * for a local time that does not exist (a daylight-saving gap), an offset that is not a whole
 * number of minutes, or a time outside the rules' range. A local time that occurs twice takes the
 * earlier offset, its first occurrence. A date without a time is returned as it is. Throws when
 * `timeZone` names a zone `rules` does not have: the specification is not valid.
 */
export function withTimeZone(
  local: string,
  timeZone: string,
  rules?: ZoneRules,
): string | undefined {
  const match = LOCAL_DATE_TIME.exec(local);
  if (match === null) return local;
  if (timeZone === "Z") return `${local}+00:00`;
  if (FIXED_OFFSET.test(timeZone)) return `${local}${timeZone}`;
  const entry = rules?.zones[timeZone];
  if (rules === undefined || entry === undefined)
    throw new Error(`time zone "${timeZone}" is not in the specification's timeZones`);
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0) / 1000;
  // The offsets in force a day around this local time: a change of offset is never closer to
  // another than that. An offset fits when the instant it gives has that offset.
  const candidates = [...new Set([-86400, 0, 86400].map((shift) => offsetAt(entry, wall + shift)))];
  const fitting = candidates.filter((offset) => offsetAt(entry, wall - offset) === offset);
  if (fitting.length === 0) return undefined;
  // Several fit when the local time occurs twice: the earlier instant has the larger offset.
  const offset = Math.max(...fitting);
  const instant = wall - offset;
  if (instant < rules.from || instant >= rules.to || offset % 60 !== 0) return undefined;
  return `${local}${formatOffset(offset)}`;
}
