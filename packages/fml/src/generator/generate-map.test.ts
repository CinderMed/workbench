import { isProjectFile, type Instance, type MappingRow, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import firstOverviewMap from "../../../../fixtures/fml-examples/metastra/FirstOverview.map?raw";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { base64, printMap } from "../fml-print.js";
import { parseFml } from "../grammar-check.js";
import { GeneratorCode } from "./codes.js";
import { roleCondition, type ColumnNames } from "./conditions.js";
import { GeneratorInputError } from "./codes.js";
import { generateMap } from "./generate-map.js";
import { planTable } from "./table-plan.js";
import { pathKey, type WrittenSegment } from "./written-paths.js";
import { testWrittenPaths } from "../test-support/written-paths.js";

function copy(document: unknown): ProjectFile {
  const file = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(file)) throw new Error("fixture is not a valid project");
  return file;
}

function generate(file: ProjectFile, sourceId: string) {
  const planned = planTable(file, sourceId);
  if (!planned.ok) throw new Error(JSON.stringify(planned.results));
  return generateMap(file, planned.value, testWrittenPaths(file));
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

  it("refuses expressions", () => {
    const file = copy(motuProject);
    row(file, "R-007").transform = {
      kind: "expression",
      language: "fml",
      expression: "x",
    } as never;
    expect(codes(file)).toEqual([
      [GeneratorCode.TRANSFORM_UNSUPPORTED, "map_07", "transform.kind"],
    ]);
    expect(codes(copy(motuProject), "src_patient")).toEqual([]);
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

describe("value maps", () => {
  const sex = (file: ProjectFile) => {
    const map = file.valueMaps.find((m) => m.id === "vm_sex");
    if (map === undefined) throw new Error("fixture changed");
    return map;
  };

  it("writes Coding targets, setElement and use.also actions, and no rule for absent", () => {
    const file = copy(motuProject);
    const map = sex(file);
    map.target = "Coding";
    map.entries = [
      {
        sourceValue: "M",
        target: { system: "http://hl7.org/fhir/administrative-gender", code: "male" },
        action: {
          kind: "use",
          also: [{ path: "active", value: { type: "boolean", value: true } }],
        },
      },
      {
        sourceValue: "F",
        action: {
          kind: "setElement",
          set: [{ path: "active", value: { type: "boolean", value: false } }],
        },
      },
      { sourceValue: "X", action: { kind: "absent" } },
    ];
    const text = printed(file, "src_patient");
    expect(text).toContain(
      "  src.Sex as v where ($this = 'M') -> res.gender = c('http://hl7.org/fhir/administrative-gender', 'male'), res.active = true \"R-002-M\";",
    );
    expect(text).toContain("  src.Sex as v where ($this = 'F') -> res.active = false \"R-002-F\";");
    expect(text).not.toContain("R-002-X");
    expect(text).toContain(
      "  // R-002: value map sex (one rule per value; ConceptMap exported separately)\n",
    );
  });

  it("comments a repeat eachValue row (Metastra R-013)", () => {
    const text = printed(copy(metastraProject), "src_firstoverview");
    expect(text).toContain(
      "  // R-013 repeat eachValue: the normalized column is a list; each rule fires for every matching value\n  // R-013: value map spineLevel",
    );
  });

  it("writes a quantity with a fixed unit", () => {
    const file = copy(metastraProject);
    row(file, "R-010").transform = {
      kind: "quantity",
      unit: { system: "http://unitsofmeasure.org", code: "g/dL" },
    };
    expect(printed(file, "src_firstoverview")).toContain(
      "    src -> q.unit = 'g/dL', q.system = 'http://unitsofmeasure.org', q.code = 'g/dL' \"R-010-unit\";",
    );
  });

  it("writes a coding from a code column, typed, with its display when present (#106)", () => {
    const file = copy(metastraProject);
    row(file, "R-006").transform = {
      kind: "coding",
      system: "http://example.org/pain",
      as: "CodeableConcept",
      displayColumnId: "col_hb_unit",
    };
    row(file, "R-011").transform = {
      kind: "coding",
      system: "http://example.org/osteo",
      as: "Coding",
    };
    const text = printed(file, "src_firstoverview");
    expect(text).toContain(
      [
        "  src.obs_pain_axial_intervals as v -> res.value = create('CodeableConcept') as cn then {",
        "    v -> cn.coding = create('Coding') as cd then {",
        "      v -> cd.system = 'http://example.org/pain', cd.code = v \"R-006-code\";",
        '      src.obs_bloodt_hb_spec as d -> cd.display = d "R-006-display";',
        '    } "R-006-coding";',
        '  } "R-006";',
      ].join("\n"),
    );
    expect(text).toContain(
      [
        "  src.cond_osteoporosis_yn as v -> res.verificationStatus = create('Coding') as cd then {",
        "    v -> cd.system = 'http://example.org/osteo', cd.code = v \"R-011-code\";",
        '  } "R-011";',
      ].join("\n"),
    );
  });

  it("writes a coding on a top-level element only (or at the top of a named slice)", () => {
    const file = copy(metastraProject);
    const r = row(file, "R-011");
    r.transform = { kind: "coding", system: "http://example.org/osteo", as: "Coding" };
    r.path = "verificationStatus.coding";
    const map = generate(file, "src_firstoverview");
    expect(map.ok ? [] : map.results.map((x) => [x.code, x.message])).toEqual([
      [
        GeneratorCode.PATH_UNSUPPORTED,
        "Row R-011: a coding is written on a top-level element only.",
      ],
    ]);
    const sliced = copy(metastraProject);
    const nrs = row(sliced, "R-007");
    nrs.transform = { kind: "coding", system: "http://example.org/nrs", as: "CodeableConcept" };
    nrs.path = "component[nrs].code";
    expect(printed(sliced, "src_firstoverview")).toContain(
      "    src.obs_pain_axial_nrs as v -> slc.code = create('CodeableConcept') as cn then {",
    );
  });

  it("reports an entry without a target and a Quantity.unit map on a value-map row", () => {
    const file = copy(motuProject);
    delete sex(file).entries[0].target;
    const map = generate(file, "src_patient");
    expect(map.ok ? [] : map.results.map((r) => r.code)).toEqual([
      GeneratorCode.VALUE_MAP_ENTRY_WITHOUT_TARGET,
    ]);
    const units = copy(metastraProject);
    row(units, "R-006").transform = { kind: "valueMap", valueMapId: "vm_hb_unit" };
    const result = generate(units, "src_firstoverview");
    expect(result.ok ? [] : result.results.map((r) => [r.code, r.id])).toContainEqual([
      GeneratorCode.TRANSFORM_UNSUPPORTED,
      "map_0006",
    ]);
  });

  it("reports two rules of a group with the same name (#90)", () => {
    const file = copy(metastraProject);
    // A value map on R-010 itself with the value "unit-1" collides with the unit rule R-010-unit-1.
    file.mappings.push({
      id: "map_0099",
      code: "R-010",
      columnId: "col_hb_unit",
      instanceId: "ins_obs1",
      path: "interpretation",
      transform: { kind: "valueMap", valueMapId: "vm_extra" },
    });
    file.valueMaps.push({
      id: "vm_extra",
      name: "extra",
      target: "code",
      entries: [{ sourceValue: "unit-1", target: { value: "x" }, action: { kind: "use" } }],
    });
    const map = generate(file, "src_firstoverview");
    expect(map.ok ? [] : map.results.map((r) => [r.code, r.message])).toEqual([
      [
        GeneratorCode.DUPLICATE_RULE_NAME,
        'Group Observation1: two rules are named "R-010-unit-1". Rename a row code or a value so that every rule of the group has its own name.',
      ],
    ]);
  });
});

describe("generateMap with a profile slice name (#150, format 1.4.0)", () => {
  it("writes a slice that starts with an upper-case letter, with valid rule names", () => {
    const file = copy(metastraProject);
    for (const role of file.instances)
      for (const slice of role.slices ?? []) if (slice.name === "nrs") slice.name = "VSCat";
    for (const r of file.mappings) r.path = r.path.replace("component[nrs]", "component[VSCat]");
    const text = printed(file, "src_firstoverview");
    expect(text).toContain(
      "src -> slc.code = cc('http://snomed.info/sct', '1284852002') \"slice-VSCat-code\";",
    );
    expect(text).toContain('} "slice-VSCat";');
    expect(parseFml(text)).toEqual([]);
  });
});

describe("choice elements written with their type (#156, ADR-0023)", () => {
  const SOURCE = "src_firstoverview";
  const OBS = "ins_obs1"; // Observation[1] · haemoglobin, written by R-010 (obs_bloodt_hb, decimal)

  /** Metastra with Observation[1]'s rows replaced by `rows`, generated with `overrides`. */
  function generateWith(
    rows: Partial<MappingRow>[],
    overrides: Record<string, WrittenSegment[]> = {},
  ) {
    const file = copy(metastraProject);
    const base = row(file, "R-010");
    file.mappings = [
      ...file.mappings.filter((r) => r.instanceId !== OBS || r.transform.kind === "reference"),
      ...rows.map((r, i): MappingRow => ({
        ...base,
        id: `map_t${String(i)}`,
        code: `R-${String(100 + i)}`,
        ...r,
      })),
    ];
    const planned = planTable(file, SOURCE);
    if (!planned.ok) throw new Error(JSON.stringify(planned.results));
    const written = new Map(testWrittenPaths(file));
    for (const [path, segments] of Object.entries(overrides))
      written.set(pathKey(OBS, path), segments);
    const map = generateMap(file, planned.value, written);
    if (!map.ok) throw new Error(JSON.stringify(map.results));
    return printMap(map.value);
  }
  const has = (text: string, line: string) => {
    expect(text.split("\n").map((l) => l.trim())).toContain(line);
  };

  it("converts a value to the chosen type: a decimal cast to string on valueString", () => {
    const text = generateWith([{ path: "valueString", transform: { kind: "cast", to: "string" } }]);
    has(
      text,
      "src.obs_bloodt_hb as v -> res.value = create('string') as x, x.value = v \"R-100\";",
    );
  });

  it("keeps a value that already has the chosen type as it is", () => {
    const text = generateWith(
      [{ path: "valueString", transform: { kind: "cast", to: "decimal" } }],
      {
        valueString: [{ name: "value", choiceType: "decimal" }],
      },
    );
    has(text, 'src.obs_bloodt_hb as v -> res.value = v "R-100";');
  });

  it("writes a constant with the chosen type: a dateTime on effectiveDateTime", () => {
    const text = generateWith([
      {
        path: "effectiveDateTime",
        transform: {
          kind: "constant",
          value: { type: "dateTime", value: "2023-05-04T10:00:00+02:00" },
        },
      },
    ]);
    has(
      text,
      "src -> res.effective = create('dateTime') as x, x.value = '2023-05-04T10:00:00+02:00' \"R-100\";",
    );
  });

  it("creates a quantity with the derived type a choice chooses (Age)", () => {
    const text = generateWith(
      [
        {
          path: "onsetAge",
          transform: { kind: "quantity", unit: { system: "http://unitsofmeasure.org", code: "a" } },
        },
      ],
      { onsetAge: [{ name: "onset", choiceType: "Age" }] },
    );
    has(text, "src.obs_bloodt_hb as v -> res.onset = create('Age') as q then {");
  });

  it("opens a path through a choice with its type, inline and in a shared block", () => {
    const inline = generateWith([{ path: "valueQuantity.value", transform: { kind: "copy" } }]);
    has(
      inline,
      "src.obs_bloodt_hb as v -> res.value = create('Quantity') as p, p.value = v \"R-100\";",
    );
    const shared = generateWith([
      { path: "valueQuantity.value", transform: { kind: "copy" } },
      {
        path: "valueQuantity.unit",
        transform: { kind: "constant", value: { type: "string", value: "g/dL" } },
      },
    ]);
    has(
      shared,
      "src where ($this.obs_bloodt_hb.exists()) -> res.value = create('Quantity') as p then {",
    );
  });

  it("takes every element name from the written paths, not from a list of names", () => {
    // doseQuantity is not a choice in R4: written by its own name.
    const text = generateWith(
      [
        {
          path: "doseQuantity",
          transform: {
            kind: "quantity",
            unit: { system: "http://unitsofmeasure.org", code: "mL" },
          },
        },
      ],
      { doseQuantity: [{ name: "doseQuantity" }] },
    );
    has(text, "src.obs_bloodt_hb as v -> res.doseQuantity = create('Quantity') as q then {");
  });

  it("stops on a path that was not resolved", () => {
    const file = copy(metastraProject);
    const planned = planTable(file, SOURCE);
    if (!planned.ok) throw new Error("plan");
    const written = new Map(testWrittenPaths(file));
    written.delete(pathKey("ins_obs0", "component[nrs].valueInteger"));
    expect(() => generateMap(file, planned.value, written)).toThrow(GeneratorInputError);
  });
});

describe("generateMap concatenation (#98)", () => {
  const concatLine = (separator: string | undefined, path = "event.text") => {
    const file = copy(motuProject);
    const r = row(file, "R-007");
    r.path = path;
    r.transform = {
      kind: "concat",
      columnIds: ["col_f_date", "col_f_id"],
      ...(separator === undefined ? {} : { separator }),
    };
    const text = printed(file, "src_fall");
    // The official grammar accepts the expression, base64 form included.
    expect(parseFml(text)).toEqual([]);
    return text
      .split("\n")
      .find((line) => line.includes('"R-007"'))
      ?.trim();
  };

  it("joins the columns in order, only when one has a value, with a space by default", () => {
    expect(concatLine(undefined)).toBe(
      "src as s where ($this.FallDate.exists() or $this.AnonymousID.exists()) -> res.event as p, p.text = evaluate(s, $this.FallDate.toString().combine($this.AnonymousID.toString()).join(' ')) \"R-007\";",
    );
  });

  it("creates a shared block when any concatenated column has a value", () => {
    const file = copy(motuProject);
    const r = row(file, "R-007");
    r.path = "event.text";
    r.transform = { kind: "concat", columnIds: ["col_f_date", "col_f_id"] };
    // A second row on `event` makes it a shared block.
    file.mappings.push({
      ...r,
      id: "map_99",
      code: "R-099",
      columnId: "col_f_adm",
      path: "event.id",
      transform: { kind: "copy" },
    });
    expect(printed(file, "src_fall")).toContain(
      "src where ($this.FallDate.exists() or $this.AnonymousID.exists() or $this.AdmissionDate.exists()) -> res.event as p then {",
    );
  });

  it("writes a separator with a quote or a control character in base64", () => {
    expect(concatLine(", ")).toContain(".join(', '))");
    // "' · '" in UTF-8, base64: the HL7 engine loses the escape of a quote (#98).
    expect(concatLine("' · '")).toContain(".join('JyDCtyAn'.decode('base64')))");
    expect(concatLine("\n")).toContain(".join('Cg=='.decode('base64')))");
  });
});

describe("base64 (concatenation separators)", () => {
  it("encodes UTF-8 bytes", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["'", "Jw=="],
      ["' · '", "JyDCtyAn"],
      ["a\nb", "YQpi"],
      ["Sì", "U8Os"],
      ["😀 x", "8J+YgCB4"],
      ["ab", "YWI="],
      ["abc", "YWJj"],
      ["abcd", "YWJjZA=="],
    ];
    for (const [text, encoded] of cases) expect(base64(text)).toBe(encoded);
  });
});
