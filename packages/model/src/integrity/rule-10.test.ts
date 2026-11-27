import { describe, expect, it } from "vitest";
import type { Column, ProjectFile } from "../generated/project.js";
import { check } from "./__tests__/helpers.js";
import { IntegrityCode } from "./index.js";

function column(p: ProjectFile, id: string): Column {
  const found = p.sources.flatMap((source) => source.columns).find((c) => c.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
}

const zones = (mutate: (p: ProjectFile) => void) =>
  check(mutate).filter((r) => r.code.startsWith("TIME_ZONE_"));

describe("rule 10: time zones (format 1.5.0)", () => {
  it("accepts fixed offsets and known IANA zones", () => {
    expect(
      zones((p) => {
        for (const source of p.sources) source.timeZone = "Europe/Rome";
        const date = column(p, "col_adm");
        date.dataType = "dateTime";
        date.timeZone = "+01:00";
      }),
    ).toEqual([]);
  });

  it("rejects an unknown zone on a table or a column, and warns on a column that is not dateTime", () => {
    const results = zones((p) => {
      p.sources[0].timeZone = "Europe/Atlantis";
      column(p, "col_sex").timeZone = "Mars/Olympus";
    });
    expect(results.map((r) => [r.severity, r.code, r.objectKind, r.field])).toEqual([
      ["error", IntegrityCode.TIME_ZONE_UNKNOWN, "source", "timeZone"],
      ["error", IntegrityCode.TIME_ZONE_UNKNOWN, "column", "timeZone"],
      ["warning", IntegrityCode.TIME_ZONE_NOT_DATETIME, "column", "timeZone"],
    ]);
    expect(results[0]?.message).toContain("Europe/Atlantis");
  });

  it("requires a zone on a dateTime column with a time, from the column or its table", () => {
    const missing = (mutate: (p: ProjectFile) => void) =>
      zones((p) => {
        const date = column(p, "col_adm");
        date.dataType = "dateTime";
        mutate(p);
      }).filter((r) => r.code === IntegrityCode.TIME_ZONE_MISSING);

    // No format means the default yyyy-MM-ddTHH:mm:ss, which has a time.
    const results = missing(() => undefined);
    expect(results.map((r) => [r.severity, r.objectKind, r.id, r.field])).toEqual([
      ["error", "column", "col_adm", "timeZone"],
    ]);
    expect(results[0]?.message).toContain("no time zone");
    expect(missing((p) => (column(p, "col_adm").dateFormat = "dd/MM/yyyy HH:mm"))).toHaveLength(1);

    const table = (p: ProjectFile) =>
      p.sources.find((t) => t.columns.some((c) => c.id === "col_adm"));
    expect(
      missing((p) => {
        const own = table(p);
        if (own !== undefined) own.timeZone = "Europe/Rome";
      }),
    ).toEqual([]);
    expect(missing((p) => (column(p, "col_adm").timeZone = "Z"))).toEqual([]);
    // A dateTime column whose values have no time gets no offset, so it needs no zone.
    expect(missing((p) => (column(p, "col_adm").dateFormat = "dd/MM/yyyy"))).toEqual([]);
  });
});
