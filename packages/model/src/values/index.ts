/**
 * Cell parsers shared by the integrity rules and the normalizer (normalization.schema.json 1.1.0).
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
 * no sign `+`, no leading zeros in the integer part.
 */
export function parseDecimal(text: string, separator: DecimalSeparator = "."): string | undefined {
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
