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
});
