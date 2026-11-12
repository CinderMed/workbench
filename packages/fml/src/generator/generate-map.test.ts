import { isProjectFile, type Instance, type MappingRow, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import firstOverviewMap from "../../../../fixtures/fml-examples/metastra/FirstOverview.map?raw";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { printMap } from "../fml-print.js";
import { GeneratorCode } from "./codes.js";
import { roleCondition, type ColumnNames } from "./conditions.js";
import { fmlElement, generateMap } from "./generate-map.js";
import { planTable } from "./table-plan.js";

function copy(document: unknown): ProjectFile {
  const file = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(file)) throw new Error("fixture is not a valid project");
  return file;
}

function generate(file: ProjectFile, sourceId: string) {
  const planned = planTable(file, sourceId);
  if (!planned.ok) throw new Error(JSON.stringify(planned.results));
  return generateMap(file, planned.value);
}

function printed(file: ProjectFile, sourceId: string): string {
  const map = generate(file, sourceId);
  if (!map.ok) throw new Error(JSON.stringify(map.results));
  return printMap(map.value);
}

const instance = (file: ProjectFile, id: string): Instance => {
  const found = file.instances.find((i) => i.id === id);
  if (found === undefined) throw new Error(`no role ${id}`);
  return found;
};
const row = (file: ProjectFile, code: string): MappingRow => {
  const found = file.mappings.find((r) => r.code === code);
  if (found === undefined) throw new Error(`no row ${code}`);
  return found;
};

/** Metastra without its value-map and quantity rows (they come with the value-map rules, #11). */
function metastraWithoutValueMaps(): ProjectFile {
  const file = copy(metastraProject);
  file.mappings = file.mappings.filter(
    (r) => r.transform.kind !== "valueMap" && r.transform.kind !== "quantity",
  );
  return file;
}

describe("fmlElement", () => {
  it("drops the type of a choice element and keeps other names", () => {
    expect(fmlElement("valueQuantity")).toBe("value");
    expect(fmlElement("valueInteger")).toBe("value");
    expect(fmlElement("effectiveDateTime")).toBe("effective");
    expect(fmlElement("onsetAge")).toBe("onset");
    expect(fmlElement("birthDate")).toBe("birthDate");
    expect(fmlElement("recordedDate")).toBe("recordedDate");
    expect(fmlElement("deceasedBoolean")).toBe("deceased");
    expect(fmlElement("status")).toBe("status");
  });
});

describe("generateMap on Metastra rows (lines of the verified map)", () => {
  const text = printed(metastraWithoutValueMaps(), "src_firstoverview");
  const lines = (block: string) => block.split("\n").map((line) => line.trim());
  const fixture = new Set(lines(firstOverviewMap));

  it.each([
    // A single row on a parent element writes it inline.
    'src.encounter_fo as v -> res.period as p, p.start = v "R-004";',
    // A named slice is a block with its discriminator; valueInteger is written as value.
    "src where ($this.obs_pain_axial_nrs.exists()) -> res.component as slc then {",
    "src -> slc.code = cc('http://snomed.info/sct', '1284852002') \"slice-nrs-code\";",
    'src.obs_pain_axial_nrs as v -> slc.value = v "R-007";',
    '} "slice-nrs";',
    // A reference to a conditional role of the same table is guarded by its condition.
    "src where ($this.encounter_fo.exists()) then {",
    "src.id_Encounter0 as t -> res.encounter as r, r.reference = evaluate(t, 'Encounter/' + $this) \"R-009\";",
    '} "R-009-guard";',
    // A reference to a role that is always created is not guarded.
    "src.id_Patient0 as t -> res.subject as r, r.reference = evaluate(t, 'Patient/' + $this) \"R-005\";",
    // Fixed values: code, Coding, CodeableConcept without display.
    "src -> res.class = c('http://terminology.hl7.org/CodeSystem/v3-ActCode', 'AMB', 'ambulatory') \"fixed-class\";",
    "src -> res.code = cc('http://snomed.info/sct', '38082009') \"fixed-code\";",
  ])("writes %s", (line) => {
    expect(fixture.has(line)).toBe(true);
    expect(lines(text)).toContain(line);
  });

  it("comments the guarded reference", () => {
    expect(text).toContain(
      "  // R-009 the reference honours the creation condition of Encounter[0]\n  src where ($this.encounter_fo.exists()) then {",
    );
  });
});

describe("roleCondition", () => {
  const file = copy(metastraProject);
  const planned = planTable(file, "src_firstoverview");
  if (!planned.ok) throw new Error("plan failed");
  const columns: ColumnNames = new Map(
    planned.value.columns.map((c) => [c.column.id, { element: c.element, name: c.column.name }]),
  );
  const condition = (id: string) => roleCondition(file, instance(file, id), columns, []);

  it("adds the skipInstance values of the role's value maps (Condition[1])", () => {
    expect(condition("ins_cond1")).toEqual({
      expr: {
        kind: "and",
        args: [
          { kind: "anyOf", column: "cond_osteoporosis_yn", values: ["1", "-1"] },
          { kind: "noneOf", column: "cond_osteoporosis_yn", values: ["0"] },
        ],
      },
      text: "cond_osteoporosis_yn in {'1', '-1'} and cond_osteoporosis_yn is not '0' (skipInstance)",
    });
  });

  it("does not repeat a skipInstance value already in createWhen (Observation[0])", () => {
    expect(condition("ins_obs0")).toEqual({
      expr: {
        kind: "and",
        args: [
          { kind: "exists", column: "obs_pain_axial_intervals" },
          { kind: "noneOf", column: "obs_pain_axial_intervals", values: ["-1"] },
        ],
      },
      text: "obs_pain_axial_intervals is not empty and obs_pain_axial_intervals is not '-1'",
    });
  });

  it("writes every operator and gives undefined for a role always created", () => {
    expect(condition("ins_patient0")).toBeUndefined();
    const target = instance(file, "ins_patient0");
    target.createWhen = {
      op: "or",
      conditions: [
        { op: "empty", columnId: "col_patient_id" },
        { op: "not", condition: { op: "notIn", columnId: "col_gender", values: ["X", "Y"] } },
        {
          op: "and",
          conditions: [
            { op: "equals", columnId: "col_gender", value: "Male" },
            { op: "notEmpty", columnId: "col_hb" },
          ],
        },
      ],
    };
    expect(condition("ins_patient0")?.text).toBe(
      "patient_id is empty or not (patient_gender not in {'X', 'Y'}) or (patient_gender = 'Male' and obs_bloodt_hb is not empty)",
    );
  });

  it("reports an expert expression", () => {
    const results: Parameters<typeof roleCondition>[3] = [];
    const target = instance(file, "ins_obs1");
    target.createWhen = { op: "expression", language: "fhirpath", expression: "true" };
    expect(roleCondition(file, target, columns, results)).toBeUndefined();
    expect(results.map((r) => r.code)).toEqual([GeneratorCode.CONDITION_EXPRESSION_UNSUPPORTED]);
  });
});

describe("generateMap errors", () => {
  const codes = (file: ProjectFile, sourceId = "src_fall") => {
    const map = generate(file, sourceId);
    return map.ok ? [] : map.results.map((r) => [r.code, r.id, r.field]);
  };

  it("refuses expressions, concatenations and (until #11, #12) value maps", () => {
    const file = copy(motuProject);
    row(file, "R-007").transform = {
      kind: "expression",
      language: "fml",
      expression: "x",
    } as never;
    expect(codes(file)).toEqual([
      [GeneratorCode.TRANSFORM_UNSUPPORTED, "map_07", "transform.kind"],
    ]);
    row(file, "R-007").transform = {
      kind: "concat",
      columnIds: ["col_f_date", "col_f_id"],
      separator: " ",
    };
    expect(codes(file)).toEqual([
      [GeneratorCode.TRANSFORM_UNSUPPORTED, "map_07", "transform.kind"],
    ]);
    expect(codes(copy(motuProject), "src_patient")).toEqual([
      [GeneratorCode.TRANSFORM_UNSUPPORTED, "map_02", "transform.kind"],
    ]);
  });

  it("refuses perValue roles, deep paths, nested fixed values and Quantity constants", () => {
    const file = copy(motuProject);
    instance(file, "ins_ae0").multiplicity = { kind: "perValue", columnId: "col_f_date" };
    row(file, "R-007").path = "suspectEntity.causality.assessment";
    const fixed = instance(file, "ins_ae0").fixedValues ?? [];
    fixed.push({ path: "event.text", value: { type: "string", value: "x" } });
    fixed.push({
      path: "resultingCondition",
      value: { type: "Quantity", unit: { system: "http://unitsofmeasure.org", code: "mg" } },
    });
    expect(codes(file)).toEqual([
      [GeneratorCode.MULTIPLICITY_PER_VALUE_UNSUPPORTED, "ins_ae0", "multiplicity.kind"],
      [GeneratorCode.PATH_UNSUPPORTED, "ins_ae0", "fixedValues"],
      [GeneratorCode.FIXED_VALUE_UNSUPPORTED, "ins_ae0", "fixedValues"],
      [GeneratorCode.PATH_UNSUPPORTED, "map_07", "path"],
    ]);
  });

  it("guards a row with its own condition, and refuses an expert expression there", () => {
    const file = copy(motuProject);
    row(file, "R-007").condition = { op: "equals", columnId: "col_f_date", value: "x" };
    expect(printed(file, "src_fall")).toContain(
      '  src where ($this.FallDate.where($this = \'x\').exists()) then {\n    src.FallDate as v -> res.date = v "R-007";\n  } "R-007-guard";',
    );
    row(file, "R-007").condition = { op: "expression", language: "fhirpath", expression: "true" };
    expect(codes(file)).toEqual([
      [GeneratorCode.CONDITION_EXPRESSION_UNSUPPORTED, "map_07", "condition"],
    ]);
  });

  it("writes a constant row and a Coding constant", () => {
    const file = copy(motuProject);
    file.mappings.push({
      id: "map_99",
      code: "R-099",
      instanceId: "ins_ae0",
      path: "outcome",
      transform: {
        kind: "constant",
        value: { type: "CodeableConcept", coding: { system: "http://s", code: "x" } },
      },
    });
    expect(printed(file, "src_fall")).toContain(
      "  src -> res.outcome = cc('http://s', 'x') \"R-099\";",
    );
  });
});
