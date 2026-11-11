import { describe, expect, it } from "vitest";
import { at, check, instance, only, row, valueMap } from "./__tests__/helpers.js";
import { IntegrityCode, MAX_ID_LENGTH, idLength } from "./index.js";

describe("rule 4: slices used in paths are declared in the role", () => {
  it("reports an undeclared slice in a row path", () => {
    const results = check((p) => {
      row(p, "map_hb").path = "component[vas].valueQuantity";
    });
    expect(only(IntegrityCode.SLICE_NOT_DECLARED, results)).toEqual([
      expect.objectContaining({
        objectKind: "mapping",
        id: "map_hb",
        field: "path",
        message: expect.stringContaining("component[vas]") as unknown,
      }),
    ]);
  });

  it("reports a slice declared on another element or on another role", () => {
    const results = check((p) => {
      row(p, "map_pid").path = "component[nrs].valueInteger";
      const slices = instance(p, "ins_obs").slices ?? [];
      at(slices, 0).path = "category";
    });
    expect(only(IntegrityCode.SLICE_NOT_DECLARED, results).map((r) => [r.id, r.field])).toEqual([
      ["ins_obs", "fixedValues.0.path"],
      ["map_pid", "path"],
      ["map_hb", "path"],
      ["vm_hb_unit", "entries.0.action.also.0.path"],
    ]);
  });

  it("reports undeclared slices in the elements set by value actions", () => {
    const results = check((p) => {
      const entries = valueMap(p, "vm_hb_unit").entries;
      at(entries, 1).action = {
        kind: "setElement",
        set: [{ path: "component[other].code.text", value: { type: "string", value: "x" } }],
      };
    });
    expect(only(IntegrityCode.SLICE_NOT_DECLARED, results)).toEqual([
      expect.objectContaining({
        objectKind: "valueMap",
        id: "vm_hb_unit",
        field: "entries.1.action.set.0.path",
      }),
    ]);
  });

  it("matches nested slices on the full prefix", () => {
    expect(
      check((p) => {
        const obs = instance(p, "ins_obs");
        obs.slices = [
          ...(obs.slices ?? []),
          {
            id: "slc_inner",
            path: "component[nrs].extension",
            name: "inner",
            discriminator: [
              { path: "url", value: { type: "uri", value: "https://example.org/x" } },
            ],
          },
        ];
        row(p, "map_hb").path = "component[nrs].extension[inner].valueString";
      }),
    ).toEqual([]);
  });
});

describe("rule 5: reference targets are reachable", () => {
  it("accepts a reference within the same table without via", () => {
    expect(
      only(
        IntegrityCode.REFERENCE_NEEDS_VIA,
        check(() => undefined),
      ),
    ).toEqual([]);
  });

  it("reports a reference to a role in another table without via", () => {
    const results = check((p) => {
      row(p, "map_stay_subj").transform = { kind: "reference", targetInstanceId: "ins_patient" };
    });
    expect(only(IntegrityCode.REFERENCE_NEEDS_VIA, results)).toEqual([
      expect.objectContaining({ id: "map_stay_subj", field: "transform.via" }),
    ]);
  });

  it("accepts a relation used in the opposite direction", () => {
    expect(
      check((p) => {
        const relation = at(p.sourceRelations ?? [], 0);
        [relation.from, relation.to] = [relation.to, relation.from];
      }),
    ).toEqual([]);
  });

  it("reports a relation that does not link the two tables", () => {
    const results = check((p) => {
      p.sources.push({
        id: "src_other",
        name: "other",
        columns: [{ id: "col_other", name: "other_id", dataType: "string" }],
      });
      at(p.sourceRelations ?? [], 0).to = { sourceId: "src_other", columnIds: ["col_other"] };
    });
    expect(only(IntegrityCode.VIA_RELATION_MISMATCH, results)).toEqual([
      expect.objectContaining({ id: "map_stay_subj", field: "transform.via" }),
    ]);
  });

  it("reports target id rule columns that the relation does not provide", () => {
    const results = check((p) => {
      instance(p, "ins_patient").idRule = {
        parts: [{ literal: "pat" }, { columnId: "col_pid" }, { columnId: "col_sex" }],
      };
    });
    expect(only(IntegrityCode.ID_RULE_NOT_REACHABLE, results)).toEqual([
      expect.objectContaining({
        id: "map_stay_subj",
        message: expect.stringContaining("col_sex") as unknown,
      }),
    ]);
  });
});

describe("rule 6: value map source values are allowed values of the columns", () => {
  it("reports a source value that the column does not allow", () => {
    const results = check((p) => {
      at(valueMap(p, "vm_sex").entries, 1).sourceValue = "X";
    });
    expect(only(IntegrityCode.VALUE_MAP_SOURCE_VALUE_UNKNOWN, results)).toEqual([
      expect.objectContaining({
        objectKind: "valueMap",
        id: "vm_sex",
        field: "entries.1.sourceValue",
        message: expect.stringContaining("'X'") as unknown,
      }),
    ]);
  });

  it("checks the unit column of a quantity", () => {
    const results = check((p) => {
      at(valueMap(p, "vm_hb_unit").entries, 0).sourceValue = "9";
    });
    expect(only(IntegrityCode.VALUE_MAP_SOURCE_VALUE_UNKNOWN, results)).toEqual([
      expect.objectContaining({ id: "vm_hb_unit", field: "entries.0.sourceValue" }),
    ]);
  });

  it("reports a value once even when several rows use the map with the same column", () => {
    const results = check((p) => {
      at(valueMap(p, "vm_sex").entries, 0).sourceValue = "X";
      p.mappings.push({ ...row(p, "map_sex"), id: "map_sex_again", code: "R-099" });
    });
    expect(only(IntegrityCode.VALUE_MAP_SOURCE_VALUE_UNKNOWN, results)).toHaveLength(1);
  });

  it("reports a categorical column used by a value map without allowed values, once", () => {
    const results = check((p) => {
      delete at(at(p.sources, 0).columns, 1).allowedValues;
      at(valueMap(p, "vm_sex").entries, 0).sourceValue = "anything";
      p.mappings.push({ ...row(p, "map_sex"), id: "map_sex_again", code: "R-099" });
    });
    expect(results).toEqual([
      {
        severity: "error",
        code: IntegrityCode.VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES,
        objectKind: "column",
        id: "col_sex",
        field: "allowedValues",
        message:
          "column 'sex' is used by value map 'sex' (row R-002) but has no allowed values: a value outside the map would be lost silently",
      },
    ]);
  });

  it("reports a multiple-choice column and the unit column of a quantity", () => {
    const results = check((p) => {
      const columns = at(p.sources, 0).columns;
      delete at(columns, 2).allowedValues;
      delete at(columns, 4).allowedValues;
    });
    expect(
      only(IntegrityCode.VALUE_MAP_COLUMN_WITHOUT_ALLOWED_VALUES, results).map((r) => r.id),
    ).toEqual(["col_hb_unit", "col_sites"]);
  });

  it("restricts value maps to categorical, multiple-choice and boolean columns", () => {
    const results = check((p) => {
      row(p, "map_pid").transform = { kind: "valueMap", valueMapId: "vm_sex" };
      row(p, "map_pid").path = "gender";
    });
    expect(results).toEqual([
      {
        severity: "error",
        code: IntegrityCode.VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED,
        objectKind: "mapping",
        id: "map_pid",
        field: "columnId",
        message:
          "value map 'sex' needs a categorical, multipleChoice or boolean column, but column 'patient_id' is string: declare the column categorical, with its allowed values",
      },
    ]);
  });

  it("reports the unit column of a quantity that is not categorical", () => {
    const results = check((p) => {
      at(at(p.sources, 0).columns, 4).dataType = "integer";
    });
    expect(
      only(IntegrityCode.VALUE_MAP_COLUMN_TYPE_NOT_ALLOWED, results).map((r) => [r.id, r.field]),
    ).toEqual([["map_hb", "transform.unitColumnId"]]);
  });

  it("accepts a boolean column without allowed values", () => {
    expect(
      check((p) => {
        const sex = at(at(p.sources, 0).columns, 1);
        sex.dataType = "boolean";
        delete sex.allowedValues;
      }).filter((r) => r.code.startsWith("VALUE_MAP_")),
    ).toEqual([]);
  });
});

describe("rule 6: a value map covers every allowed value of its columns", () => {
  it("reports the allowed values without an entry, once per map and column", () => {
    const results = check((p) => {
      at(at(p.sources, 0).columns, 1).allowedValues = [
        { code: "M" },
        { code: "F" },
        { code: "U" },
        { code: "X " },
      ];
      p.mappings.push({ ...row(p, "map_sex"), id: "map_sex_again", code: "R-099" });
    });
    expect(results).toEqual([
      {
        severity: "error",
        code: IntegrityCode.VALUE_MAP_INCOMPLETE,
        objectKind: "valueMap",
        id: "vm_sex",
        field: "entries",
        message:
          "value map 'sex' has no entry for 'U', 'X' of column 'sex' (row R-002): add an entry with a code or an action (skipInstance, setElement, absent)",
      },
    ]);
  });

  it("does not require entries for missing values", () => {
    expect(
      check((p) => {
        const sex = at(at(p.sources, 0).columns, 1);
        sex.allowedValues = [{ code: "M" }, { code: "F" }, { code: "99" }];
        sex.missingValues = ["99"];
      }),
    ).toEqual([]);
  });

  it("counts an entry with an action as covered", () => {
    expect(
      check((p) => {
        at(at(p.sources, 0).columns, 1).allowedValues = [
          { code: "M" },
          { code: "F" },
          { code: "U" },
        ];
        valueMap(p, "vm_sex").entries.push({ sourceValue: "U", action: { kind: "skipInstance" } });
      }),
    ).toEqual([]);
  });

  it("compares after NFC and trim, case-sensitive", () => {
    const results = check((p) => {
      at(at(p.sources, 0).columns, 1).allowedValues = [
        { code: "M" },
        { code: "F" },
        { code: "Sì" },
      ];
      const entries = valueMap(p, "vm_sex").entries;
      entries.push({ sourceValue: "si", action: { kind: "absent" } });
    });
    expect(
      only(IntegrityCode.VALUE_MAP_INCOMPLETE, results).map((r) => r.message.split(":")[0]),
    ).toEqual(["value map 'sex' has no entry for 'Sì' of column 'sex' (row R-002)"]);
  });

  it("checks multiple-choice columns and the unit column of a quantity", () => {
    const results = check((p) => {
      at(at(p.sources, 0).columns, 2).allowedValues = [{ code: "1" }, { code: "2" }, { code: "3" }];
      at(at(p.sources, 0).columns, 4).allowedValues = [{ code: "1" }, { code: "2" }, { code: "4" }];
    });
    expect(only(IntegrityCode.VALUE_MAP_INCOMPLETE, results).map((r) => r.id)).toEqual([
      "vm_hb_unit",
      "vm_sites",
    ]);
  });
});

describe("rule 7: generated ids fit the FHIR id limit", () => {
  it("computes the length of hash and sanitize ids", () => {
    // "pat" + "-" + 24 hex characters
    expect(idLength({ parts: [{ literal: "pat" }, { columnId: "c1" }] })).toBe(28);
    // literals and one hash, whatever the number of columns
    expect(
      idLength({
        parts: [{ literal: "a" }, { columnId: "c1" }, { columnId: "c2" }],
        hashLength: 16,
      }),
    ).toBe(18);
    // sanitize: at least one character per column, each piece separated
    expect(
      idLength({
        parts: [{ literal: "enc" }, { columnId: "c1" }, { columnId: "c2" }],
        encoding: "sanitize",
      }),
    ).toBe(7);
    // literals only
    expect(idLength({ parts: [{ literal: "org" }, { literal: "main" }], separator: "." })).toBe(8);
  });

  it("accepts an id of exactly 64 characters", () => {
    expect(
      check((p) => {
        instance(p, "ins_patient").idRule = {
          parts: [{ literal: "x".repeat(MAX_ID_LENGTH - 41) }, { columnId: "col_pid" }],
          hashLength: 40,
        };
      }),
    ).toEqual([]);
  });

  it("reports an id longer than 64 characters", () => {
    const results = check((p) => {
      instance(p, "ins_patient").idRule = {
        parts: [{ literal: "x".repeat(MAX_ID_LENGTH - 40) }, { columnId: "col_pid" }],
        hashLength: 40,
      };
    });
    expect(only(IntegrityCode.ID_TOO_LONG, results)).toEqual([
      expect.objectContaining({
        id: "ins_patient",
        field: "idRule",
        message: expect.stringContaining("65") as unknown,
      }),
    ]);
  });

  it("reports fixed parts that are already too long with sanitize", () => {
    const results = check((p) => {
      instance(p, "ins_stay").idRule = {
        // 63 + separator + at least one character
        parts: [{ literal: "e".repeat(63) }, { columnId: "col_sid" }],
        encoding: "sanitize",
      };
    });
    expect(only(IntegrityCode.ID_TOO_LONG, results)).toEqual([
      expect.objectContaining({
        id: "ins_stay",
        message: expect.stringContaining("at least 65") as unknown,
      }),
    ]);
  });

  it("reports characters not allowed in a FHIR id", () => {
    const results = check((p) => {
      instance(p, "ins_patient").idRule = {
        parts: [{ literal: "pat_ok" }, { columnId: "col_pid" }],
        separator: "/",
      };
    });
    expect(only(IntegrityCode.ID_INVALID_CHARACTERS, results).map((r) => r.field)).toEqual([
      "idRule.parts.0.literal",
      "idRule.separator",
    ]);
  });
});

describe("rule 8: repeat eachValue only with multipleChoice columns", () => {
  it("reports repeat on a categorical column", () => {
    const results = check((p) => {
      row(p, "map_sex").repeat = { kind: "eachValue" };
    });
    expect(only(IntegrityCode.REPEAT_REQUIRES_MULTIPLE_CHOICE, results)).toEqual([
      expect.objectContaining({
        id: "map_sex",
        field: "repeat",
        message: expect.stringContaining("categorical") as unknown,
      }),
    ]);
  });

  it("reports repeat on a row without a column", () => {
    const results = check((p) => {
      row(p, "map_obs_subj").repeat = { kind: "eachValue" };
    });
    expect(only(IntegrityCode.REPEAT_REQUIRES_MULTIPLE_CHOICE, results)).toEqual([
      expect.objectContaining({
        id: "map_obs_subj",
        message: expect.stringContaining("without a column") as unknown,
      }),
    ]);
  });

  it("leaves a dangling column to rule 1", () => {
    const results = check((p) => {
      row(p, "map_sites").columnId = "col_gone";
    });
    expect(only(IntegrityCode.REPEAT_REQUIRES_MULTIPLE_CHOICE, results)).toEqual([]);
    expect(only(IntegrityCode.DANGLING_REFERENCE, results)).toHaveLength(1);
  });
});
