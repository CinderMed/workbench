import { describe, expect, it } from "vitest";
import {
  canonicalText,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
} from "./index.js";

describe("canonicalText", () => {
  it("applies NFC and trims", () => {
    expect(canonicalText("  Sì ")).toBe("Sì");
  });
});

describe("parseInteger", () => {
  it.each([
    ["42", "42"],
    ["+007", "7"],
    ["-0", "0"],
    ["-12", "-12"],
    ["123456789012345678901234567890", "123456789012345678901234567890"],
  ])("%s → %s", (text, value) => {
    expect(parseInteger(text)).toBe(value);
  });

  it.each(["", "1.0", "1,0", "abc", "1e3", " 1"])("rejects %j", (text) => {
    expect(parseInteger(text)).toBeUndefined();
  });
});

describe("parseDecimal", () => {
  it.each([
    ["11.20", ".", "11.20"],
    ["011.20", ".", "11.20"],
    ["+3", ".", "3"],
    ["-007.5", ".", "-7.5"],
    ["11,20", ",", "11.20"],
    ["0,5", ",", "0.5"],
  ] as const)("%s with '%s' → %s", (text, separator, value) => {
    expect(parseDecimal(text, separator)).toBe(value);
  });

  it.each([
    ["11,20", "."],
    ["1.234,5", ","],
    ["11.", "."],
    [".5", "."],
    ["abc", "."],
    ["", ","],
  ] as const)("rejects %j with '%s'", (text, separator) => {
    expect(parseDecimal(text, separator)).toBeUndefined();
  });
});

describe("parseBoolean", () => {
  it.each(["1", "true", "TRUE", "yes", "Yes", "y", "Y"])("%s → true", (text) => {
    expect(parseBoolean(text)).toBe(true);
  });
  it.each(["0", "false", "False", "no", "NO", "n"])("%s → false", (text) => {
    expect(parseBoolean(text)).toBe(false);
  });
  it.each(["Sì", "si", "No ", "vero", "2", ""])("rejects %j", (text) => {
    expect(parseBoolean(text)).toBeUndefined();
  });
});

describe("parseDate", () => {
  it.each([
    ["17/09/2023", "dd/MM/yyyy", "2023-09-17"],
    ["29/02/2024", "dd/MM/yyyy", "2024-02-29"],
    ["2023-09-17", undefined, "2023-09-17"],
    ["2023", "yyyy", "2023"],
    ["09/2023", "MM/yyyy", "2023-09"],
    ["17.09.2023", "dd.MM.yyyy", "2023-09-17"],
  ])("%s as %s → %s", (text, format, value) => {
    expect(parseDate(text, format)).toBe(value);
  });

  it.each([
    ["31/02/2023", "dd/MM/yyyy"],
    ["29/02/2023", "dd/MM/yyyy"],
    ["00/01/2023", "dd/MM/yyyy"],
    ["13/2023", "MM/yyyy"],
    ["17x09x2023", "dd.MM.yyyy"],
    ["2023-9-17", undefined],
    ["17/09", "dd/MM"],
  ])("rejects %s as %s", (text, format) => {
    expect(parseDate(text, format)).toBeUndefined();
  });
});

describe("parseDateTime", () => {
  it.each([
    ["17/09/2023 14:05", "dd/MM/yyyy HH:mm", "2023-09-17T14:05:00"],
    ["2023-09-17T23:59:59", undefined, "2023-09-17T23:59:59"],
    ["17/09/2023", "dd/MM/yyyy", "2023-09-17"],
  ])("%s as %s → %s", (text, format, value) => {
    expect(parseDateTime(text, format)).toBe(value);
  });

  it.each([
    ["17/09/2023 24:00", "dd/MM/yyyy HH:mm"],
    ["17/09/2023 10:60", "dd/MM/yyyy HH:mm"],
    ["2023-09-17", undefined],
  ])("rejects %s as %s", (text, format) => {
    expect(parseDateTime(text, format)).toBeUndefined();
  });
});
