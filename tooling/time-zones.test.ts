// Offsets of a declared time zone (normalization 1.3.0, #107, ADR-0024), on the workbench's tzdata
// snapshot. The rules: a local time that does not exist is invalid, one that occurs twice takes
// the earlier offset, an offset that is not a whole number of minutes or a time outside the
// snapshot's range is invalid.
import { describe, expect, it } from "vitest";
import snapshot from "../packages/export/src/time-zones/zones.json" with { type: "json" };
import names from "../packages/model/src/values/time-zone-names.json" with { type: "json" };
import {
  TZDATA_VERSION,
  formatHasTime,
  isKnownTimeZone,
  withTimeZone,
  type ZoneRules,
} from "../packages/model/src/index.js";

const rules: ZoneRules = snapshot;

describe("withTimeZone", () => {
  it.each([
    // Fixed offsets, and Z written as +00:00.
    ["2025-01-15T10:00:00", "+05:30", "2025-01-15T10:00:00+05:30"],
    ["2025-01-15T10:00:00", "-14:00", "2025-01-15T10:00:00-14:00"],
    ["2025-01-15T10:00:00", "Z", "2025-01-15T10:00:00+00:00"],
    // Europe/Rome, winter and summer.
    ["2025-01-15T10:00:00", "Europe/Rome", "2025-01-15T10:00:00+01:00"],
    ["2025-07-15T10:00:00", "Europe/Rome", "2025-07-15T10:00:00+02:00"],
    // Spring forward on 30 March 2025: 02:00–02:59 does not exist.
    ["2025-03-30T01:59:59", "Europe/Rome", "2025-03-30T01:59:59+01:00"],
    ["2025-03-30T02:00:00", "Europe/Rome", undefined],
    ["2025-03-30T02:59:59", "Europe/Rome", undefined],
    ["2025-03-30T03:00:00", "Europe/Rome", "2025-03-30T03:00:00+02:00"],
    // Fall back on 26 October 2025: 02:00–02:59 occurs twice, the first time at +02:00.
    ["2025-10-26T02:00:00", "Europe/Rome", "2025-10-26T02:00:00+02:00"],
    ["2025-10-26T02:59:59", "Europe/Rome", "2025-10-26T02:59:59+02:00"],
    ["2025-10-26T03:00:00", "Europe/Rome", "2025-10-26T03:00:00+01:00"],
    // New York in MIMIC-IV's shifted years, as MIMIC-IV on FHIR writes them.
    ["2113-08-04T18:46:00", "America/New_York", "2113-08-04T18:46:00-04:00"],
    ["2120-01-30T19:44:00", "America/New_York", "2120-01-30T19:44:00-05:00"],
    // Outside the snapshot's range [1970, 2300).
    ["1969-12-31T23:00:00", "Europe/Rome", undefined],
    ["1970-01-01T01:00:00", "Europe/Rome", "1970-01-01T01:00:00+01:00"],
    ["2299-12-31T23:59:59", "UTC", "2299-12-31T23:59:59+00:00"],
    ["2300-01-01T00:00:00", "UTC", undefined],
    // Liberia at -00:44:30 until 1972: not a whole number of minutes.
    ["1971-06-01T12:00:00", "Africa/Monrovia", undefined],
    ["1972-06-01T12:00:00", "Africa/Monrovia", "1972-06-01T12:00:00+00:00"],
    // A date without a time has no offset.
    ["2025-03-30", "Europe/Rome", "2025-03-30"],
  ])("%s in %s → %s", (local, zone, expected) => {
    expect(withTimeZone(local, zone, rules)).toBe(expected);
  });

  it("refuses a zone the specification does not have", () => {
    expect(() =>
      withTimeZone("2025-01-15T10:00:00", "Europe/Rome", { ...rules, zones: {} }),
    ).toThrow(/not in the specification's timeZones/);
  });
});

describe("time-zone names", () => {
  it("knows fixed offsets and the snapshot's zones, nothing else", () => {
    expect(isKnownTimeZone("+01:00")).toBe(true);
    expect(isKnownTimeZone("Z")).toBe(true);
    expect(isKnownTimeZone("Europe/Rome")).toBe(true);
    expect(isKnownTimeZone("Europe/Atlantis")).toBe(false);
    expect(isKnownTimeZone("+15:00")).toBe(false);
  });

  it("are the snapshot's zones, from the same tzdata", () => {
    expect(names.names).toEqual(Object.keys(snapshot.zones));
    expect([names.tzdata, names.from, names.to]).toEqual([
      snapshot.tzdata,
      snapshot.from,
      snapshot.to,
    ]);
    expect(TZDATA_VERSION).toBe(snapshot.tzdata);
  });

  it("say which formats have a time", () => {
    expect(formatHasTime(undefined)).toBe(true);
    expect(formatHasTime("yyyy-MM-dd HH:mm")).toBe(true);
    expect(formatHasTime("dd/MM/yyyy")).toBe(false);
  });
});
