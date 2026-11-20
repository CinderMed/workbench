import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Column, type MappingRow, type ProjectFile, isProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import {
  UCUM,
  type TransformDraft,
  buildRow,
  castTypes,
  draftOf,
  kindsFor,
  tableColumns,
} from "./transform-form";

const FIXTURES = join(__dirname, "../../../../fixtures/fml-examples");

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

/** Every fixture project: a wide table, long tables and several related tables. */
function fixtureProjects(): [string, ProjectFile][] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const text = readFileSync(join(FIXTURES, d.name, "project.json"), "utf8");
        return [[d.name, load(JSON.parse(text))] as [string, ProjectFile]];
      } catch {
        return [];
      }
    });
}

const columnOf = (project: ProjectFile, row: MappingRow): Column | undefined =>
  project.sources.flatMap((s) => s.columns).find((c) => c.id === row.columnId);

const metastra = () => load(metastraProject);
const rowByCode = (project: ProjectFile, code: string): MappingRow => {
  const row = project.mappings.find((m) => m.code === code);
  if (row === undefined) throw new Error(code);
  return row;
};

/** A row's form, changed by `fields`, built back. */
function rebuild(project: ProjectFile, row: MappingRow, fields: Partial<TransformDraft>) {
  const column = columnOf(project, row);
  return buildRow({ ...draftOf(row, column), ...fields }, row, column);
}

describe("guided transforms (D5)", () => {
  it("gives back every fixture row unchanged when its form is saved as it opens", () => {
    const projects = fixtureProjects();
    expect(projects.map(([name]) => name)).toEqual(
      expect.arrayContaining(["metastra", "motu", "mimic-iv-demo", "type-combinations"]),
    );
    let checked = 0;
    for (const [name, project] of projects)
      for (const row of project.mappings) {
        if (row.transform.kind === "reference" || row.transform.kind === "expression") continue;
        const built = rebuild(project, row, {});
        expect({ name, built }).toEqual({ name, built: { row } });
        checked += 1;
      }
    expect(checked).toBeGreaterThan(50);
  });

  it("builds the Metastra transforms from a copy, as the grid does", () => {
    const project = metastra();
    const asCopy = (code: string): MappingRow => {
      const row: MappingRow = { ...rowByCode(project, code), transform: { kind: "copy" } };
      delete row.repeat;
      return row;
    };
    const build = (code: string, fields: Partial<TransformDraft>) => {
      const row = asCopy(code);
      const column = columnOf(project, row);
      return buildRow({ ...draftOf(row, column), ...fields }, row, column);
    };
    // R-003: a date read as dd/MM/yyyy.
    expect(build("R-003", { kind: "cast", castTo: "date", inputFormat: "dd/MM/yyyy" })).toEqual({
      row: rowByCode(project, "R-003"),
    });
    // R-010: haemoglobin with its unit from another column, through a value map.
    expect(
      build("R-010", {
        kind: "quantity",
        unitMode: "column",
        unitColumnId: "col_hb_unit",
        unitValueMapId: "vm_hb_unit",
      }),
    ).toEqual({ row: rowByCode(project, "R-010") });
    // R-013: a multiple-choice column, one bodySite per level.
    expect(
      build("R-013", { kind: "valueMap", valueMapId: "vm_spine_level", repeat: true }),
    ).toEqual({ row: rowByCode(project, "R-013") });
  });

  it("offers the transforms of a row and the conversions of its column", () => {
    const project = metastra();
    const date = columnOf(project, rowByCode(project, "R-003"));
    expect(kindsFor(date)).toEqual(["copy", "cast", "valueMap", "quantity", "coding"]);
    // Concatenation only for a row that already has one (the export cannot write it yet, #98).
    expect(kindsFor(date, "concat")).toEqual([
      "copy",
      "cast",
      "valueMap",
      "quantity",
      "coding",
      "concat",
    ]);
    expect(
      draftOf(
        { ...rowByCode(project, "R-003"), transform: { kind: "concat", columnIds: ["a", "b"] } },
        date,
      ).kind,
    ).toBe("concat");
    expect(kindsFor(undefined)).toEqual(["constant"]);
    expect(castTypes(date)).toEqual(["string", "date", "dateTime"]);
    expect(castTypes(columnOf(project, rowByCode(project, "R-007")))).toEqual([
      "string",
      "integer",
      "decimal",
    ]);
    expect(tableColumns(project, date)).toBe(project.sources[0].columns);
  });

  it("refuses what is missing or not allowed, and keeps what was not changed", () => {
    const project = metastra();
    const error = (code: string, fields: Partial<TransformDraft>) => {
      const built = rebuild(project, rowByCode(project, code), fields);
      return "error" in built ? built.error : undefined;
    };
    expect(error("R-007", { kind: "cast", castTo: "date" })).toBe("castNotAllowed");
    expect(error("R-007", { kind: "cast", castTo: "" })).toBe("castToRequired");
    expect(error("R-002", { kind: "valueMap", valueMapId: "" })).toBe("valueMapRequired");
    expect(error("R-007", { kind: "quantity", unitMode: "fixed", unitCode: " " })).toBe(
      "unitRequired",
    );
    expect(error("R-007", { kind: "quantity", unitMode: "column", unitColumnId: "" })).toBe(
      "unitColumnRequired",
    );
    expect(
      error("R-007", {
        kind: "quantity",
        unitMode: "column",
        unitColumnId: "c",
        unitValueMapId: "",
      }),
    ).toBe("unitValueMapRequired");
    expect(error("R-007", { kind: "coding", system: "" })).toBe("systemRequired");
    expect(error("R-001", { kind: "concat", columnIds: ["col_patient_id"] })).toBe("concatTooFew");
    expect(error("R-007", { repeat: true })).toBe("repeatNeedsMultipleChoice");

    // A fixed unit is UCUM; a concatenation keeps the order the columns were chosen in.
    const quantity = rebuild(project, rowByCode(project, "R-007"), {
      kind: "quantity",
      unitMode: "fixed",
      unitCode: "{score}",
      unitDisplay: "",
    });
    expect("row" in quantity && quantity.row.transform).toEqual({
      kind: "quantity",
      unit: { system: UCUM, code: "{score}" },
    });
    const concat = rebuild(project, rowByCode(project, "R-001"), {
      kind: "concat",
      columnIds: ["col_encounter_fo", "col_patient_id"],
      separator: "-",
    });
    expect("row" in concat && concat.row.transform).toEqual({
      kind: "concat",
      columnIds: ["col_encounter_fo", "col_patient_id"],
      separator: "-",
    });
    // Turning repeat off removes it.
    const noRepeat = rebuild(project, rowByCode(project, "R-013"), { repeat: false });
    expect("row" in noRepeat && noRepeat.row).not.toHaveProperty("repeat");
  });

  it("builds constants strictly, and keeps a coding's verification when it is not changed", () => {
    const row: MappingRow = {
      id: "map_c",
      code: "R-100",
      instanceId: "ins_patient0",
      path: "identifier.system",
      transform: {
        kind: "constant",
        value: {
          type: "Coding",
          coding: { system: "http://loinc.org", code: "1-8", verification: { status: "verified" } },
        },
      },
    };
    const build = (fields: Partial<TransformDraft>) => {
      const built = buildRow({ ...draftOf(row, undefined), ...fields }, row, undefined);
      return "row" in built ? built.row.transform : built.error;
    };
    expect(build({})).toEqual(row.transform);
    const changed = build({
      value: { system: "http://loinc.org", code: "2-6", display: "", value: "" },
    });
    expect(changed).toEqual({
      kind: "constant",
      value: {
        type: "Coding",
        coding: { system: "http://loinc.org", code: "2-6", verification: { status: "manual" } },
      },
    });
    const uri = { system: "", code: "", display: "" };
    expect(build({ valueType: "uri", value: { ...uri, value: "http://example.org/ids" } })).toEqual(
      {
        kind: "constant",
        value: { type: "uri", value: "http://example.org/ids" },
      },
    );
    expect(build({ valueType: "decimal", value: { ...uri, value: "0,25" } })).toBe("valueInvalid");
    expect(build({ valueType: "Quantity" })).toBe("constantTypeRequired");
  });
});
