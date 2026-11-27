// Time zones in the normalization specification (normalization 1.3.0, #107, ADR-0024): a dateTime
// column with a time gets its own zone or its table's; the specification carries the offset rules
// of the IANA zones it uses, given by the export as plain data.
import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { GeneratorInputError } from "./codes.js";
import { normalizationSpec, type ZoneRuleSource } from "./normalization-spec.js";
import { planTable } from "./table-plan.js";

const RULES: ZoneRuleSource = {
  tzdata: "test",
  from: 0,
  to: 100,
  zone: (name) =>
    ({ "Europe/Rome": [3600, 50, 7200], "America/New_York": [-18000] })[name] ?? undefined,
};

/** MOTU's Fall table with its two dates as dateTime: admission with a time, fall date only. */
function fall(change: (project: ProjectFile) => void): ProjectFile {
  const project = JSON.parse(JSON.stringify(motuProject)) as unknown;
  if (!isProjectFile(project)) throw new Error("not a project");
  for (const column of project.sources.flatMap((s) => s.columns)) {
    if (column.id === "col_f_adm")
      Object.assign(column, { dataType: "dateTime", dateFormat: "dd/MM/yyyy HH:mm" });
    if (column.id === "col_f_date")
      Object.assign(column, { dataType: "dateTime", dateFormat: "dd/MM/yyyy" });
  }
  change(project);
  return project;
}

/** `null`: no zone rules given. */
function spec(project: ProjectFile, rules: ZoneRuleSource | null = RULES) {
  const plan = planTable(project, "src_fall");
  if (!plan.ok) throw new Error(JSON.stringify(plan.results));
  return normalizationSpec(project, plan.value, rules === null ? {} : { zoneRules: rules });
}

const zoneOf = (s: ReturnType<typeof spec>, name: string) =>
  s.columns.find((c) => c.sourceName === name)?.timeZone;

const table = (p: ProjectFile) => {
  const source = p.sources.find((s) => s.id === "src_fall");
  if (source === undefined) throw new Error("no Fall table");
  return source;
};

describe("normalization specification time zones", () => {
  it("gives a dateTime column with a time its table's zone, with the zone's rules", () => {
    const s = spec(fall((p) => (table(p).timeZone = "Europe/Rome")));
    expect(zoneOf(s, "AdmissionDate")).toBe("Europe/Rome");
    // A format without a time has no offset to write.
    expect(zoneOf(s, "FallDate")).toBeUndefined();
    expect(s.formatVersion).toBe("1.3.0");
    expect(s.timeZones).toEqual({
      tzdata: "test",
      from: 0,
      to: 100,
      zones: { "Europe/Rome": [3600, 50, 7200] },
    });
  });

  it("prefers the column's own zone, and writes no rules for a fixed offset", () => {
    const s = spec(
      fall((p) => {
        table(p).timeZone = "America/New_York";
        const column = table(p).columns.find((c) => c.id === "col_f_adm");
        if (column !== undefined) column.timeZone = "+01:00";
      }),
    );
    expect(zoneOf(s, "AdmissionDate")).toBe("+01:00");
    expect(s.timeZones).toBeUndefined();
  });

  it("writes no time zone when none is declared, as before 1.3.0", () => {
    const s = spec(
      fall(() => undefined),
      undefined,
    );
    expect(zoneOf(s, "AdmissionDate")).toBeUndefined();
    expect(s).not.toHaveProperty("timeZones");
  });

  it("needs the rules of an IANA zone, and a zone they have", () => {
    const rome = fall((p) => (table(p).timeZone = "Europe/Rome"));
    expect(() => spec(rome, null)).toThrow(GeneratorInputError);
    const atlantis = fall((p) => (table(p).timeZone = "Europe/Atlantis"));
    expect(() => spec(atlantis)).toThrow(/TIME_ZONE_UNKNOWN/);
  });
});
