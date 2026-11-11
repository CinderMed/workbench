import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import type { ProjectFile } from "../generated/project.js";
import { isProjectFile, validateProjectSchema } from "../schema-validation.js";
import { cleanProject } from "./__tests__/builder.js";
import { at, check, instance, only, row } from "./__tests__/helpers.js";
import { IntegrityCode, checkIntegrity } from "./index.js";

describe("the clean projects", () => {
  it("the test builder is valid for the schema and has no integrity errors", () => {
    const project = cleanProject();
    expect(validateProjectSchema(project)).toEqual([]);
    expect(checkIntegrity(project)).toEqual([]);
  });

  it.each([
    ["metastra", metastraProject],
    ["motu", motuProject],
  ])("the %s example has no integrity errors", (_name, example) => {
    const project: unknown = example;
    if (!isProjectFile(project)) throw new Error("example is not schema-valid");
    expect(checkIntegrity(project)).toEqual([]);
  });
});

describe("rule 1: unique ids and existing references of the right kind", () => {
  it("reports a duplicate id on the second object, wherever it is", () => {
    const results = check((p) => {
      at(p.mappings, 1).id = "map_pid";
      at(p.instances, 1).slices = [{ ...at(at(p.instances, 1).slices ?? [], 0), id: "col_pid" }];
    });
    expect(only(IntegrityCode.DUPLICATE_ID, results)).toEqual([
      expect.objectContaining({ objectKind: "instance", id: "ins_obs", field: "slices.0.id" }),
      expect.objectContaining({ objectKind: "mapping", id: "map_pid", field: "id" }),
    ]);
  });

  it("reports duplicate ids of comments, sections, template applications and the project", () => {
    const results = check((p) => {
      p.project.id = "ins_patient";
      const source = at(p.sources, 0);
      source.sections = [{ id: "tpl_visit", name: "Clash" }];
      at(source.columns, 0).sectionId = "tpl_visit";
      const template = at(p.templates ?? [], 0);
      template.applications = [{ id: "cmt_first", arguments: {} }];
    });
    // The first object in file order keeps the id; the later ones are reported.
    expect(
      only(IntegrityCode.DUPLICATE_ID, results).map((r) => [r.objectKind, r.id, r.field]),
    ).toEqual([
      ["instance", "ins_patient", "id"],
      ["template", "tpl_visit", "id"],
      ["template", "tpl_visit", "applications.0.id"],
    ]);
  });

  it.each<[string, (p: ProjectFile) => void, string, string]>([
    [
      "a row to a missing role",
      (p) => {
        row(p, "map_pid").instanceId = "ins_nowhere";
      },
      "map_pid",
      "instanceId",
    ],
    [
      "a role to a missing table",
      (p) => {
        instance(p, "ins_obs").sourceId = "src_nowhere";
      },
      "ins_obs",
      "sourceId",
    ],
    [
      "a group column",
      (p) => {
        instance(p, "ins_stay").multiplicity = { kind: "perGroup", groupBy: ["col_gone"] };
      },
      "ins_stay",
      "multiplicity.groupBy.0",
    ],
    [
      "a nested condition column",
      (p) => {
        instance(p, "ins_obs").createWhen = {
          op: "not",
          condition: { op: "empty", columnId: "col_gone" },
        };
      },
      "ins_obs",
      "createWhen.condition.columnId",
    ],
    [
      "an id rule column",
      (p) => {
        instance(p, "ins_patient").idRule = { parts: [{ columnId: "col_gone" }] };
      },
      "ins_patient",
      "idRule.parts.0.columnId",
    ],
    [
      "a context encounter",
      (p) => {
        instance(p, "ins_obs").context = { encounterInstanceId: "ins_gone" };
      },
      "ins_obs",
      "context.encounterInstanceId",
    ],
    [
      "a template",
      (p) => {
        instance(p, "ins_stay").templateId = "tpl_gone";
      },
      "ins_stay",
      "templateId",
    ],
    [
      "a value map",
      (p) => {
        row(p, "map_sex").transform = { kind: "valueMap", valueMapId: "vm_gone" };
      },
      "map_sex",
      "transform.valueMapId",
    ],
    [
      "a unit value map",
      (p) => {
        row(p, "map_hb").transform = {
          kind: "quantity",
          unitColumnId: "col_hb_unit",
          unitValueMapId: "vm_gone",
        };
      },
      "map_hb",
      "transform.unitValueMapId",
    ],
    [
      "a reference target",
      (p) => {
        row(p, "map_obs_subj").transform = { kind: "reference", targetInstanceId: "ins_gone" };
      },
      "map_obs_subj",
      "transform.targetInstanceId",
    ],
    [
      "a via relation",
      (p) => {
        row(p, "map_stay_subj").transform = {
          kind: "reference",
          targetInstanceId: "ins_patient",
          via: "rel_gone",
        };
      },
      "map_stay_subj",
      "transform.via",
    ],
    [
      "a concat column",
      (p) => {
        row(p, "map_label").transform = { kind: "concat", columnIds: ["col_sid", "col_gone"] };
      },
      "map_label",
      "transform.columnIds.1",
    ],
    [
      "a row condition column",
      (p) => {
        row(p, "map_hb").condition = {
          op: "or",
          conditions: [
            { op: "empty", columnId: "col_hb" },
            { op: "empty", columnId: "col_gone" },
          ],
        };
      },
      "map_hb",
      "condition.conditions.1.columnId",
    ],
    [
      "a comment reply",
      (p) => {
        const column = at(at(p.sources, 0).columns, 4);
        const reply = at(column.review?.comments ?? [], 1);
        reply.replyTo = "cmt_gone";
      },
      "col_hb_unit",
      "review.comments.1.replyTo",
    ],
    [
      "a relation table",
      (p) => {
        at(p.sourceRelations ?? [], 0).to.sourceId = "src_gone";
      },
      "rel_stay_patient",
      "to.sourceId",
    ],
    [
      "a template role",
      (p) => {
        at(p.templates ?? [], 0).instanceIds = ["ins_gone"];
      },
      "tpl_visit",
      "instanceIds.0",
    ],
    [
      "a row key column",
      (p) => {
        at(p.sources, 1).rowKey = ["col_gone"];
      },
      "src_stay",
      "rowKey.0",
    ],
    [
      "a section",
      (p) => {
        at(at(p.sources, 0).columns, 1).sectionId = "sec_gone";
      },
      "col_sex",
      "sectionId",
    ],
  ])("reports a dangling reference: %s", (_name, mutate, id, field) => {
    expect(only(IntegrityCode.DANGLING_REFERENCE, check(mutate))).toEqual([
      expect.objectContaining({ severity: "error", id, field }),
    ]);
  });

  it("reports a reference to an object of another kind", () => {
    const results = check((p) => {
      row(p, "map_pid").instanceId = "col_pid";
      instance(p, "ins_obs").context = { patientInstanceId: "vm_sex" };
    });
    expect(only(IntegrityCode.WRONG_REFERENCE_KIND, results)).toEqual([
      expect.objectContaining({
        objectKind: "instance",
        id: "ins_obs",
        field: "context.patientInstanceId",
        message: expect.stringContaining("is a valueMap") as unknown,
      }),
      expect.objectContaining({ objectKind: "mapping", id: "map_pid", field: "instanceId" }),
    ]);
  });

  it("accepts a reference when one of several objects with the id has the right kind", () => {
    const results = check((p) => {
      at(p.mappings, 1).id = "ins_patient";
    });
    expect(only(IntegrityCode.WRONG_REFERENCE_KIND, results)).toEqual([]);
    expect(only(IntegrityCode.DUPLICATE_ID, results)).toHaveLength(1);
  });
});

describe("rule 2: unique role keys and row codes", () => {
  it("reports a second role with the same type and index", () => {
    const results = check((p) => {
      instance(p, "ins_site").resourceType = "Observation";
    });
    expect(only(IntegrityCode.DUPLICATE_INSTANCE_KEY, results)).toEqual([
      expect.objectContaining({
        id: "ins_site",
        field: "index",
        message: expect.stringContaining("Observation[0]") as unknown,
      }),
    ]);
  });

  it("accepts the same type with another index", () => {
    expect(
      check((p) => {
        instance(p, "ins_site").resourceType = "Observation";
        instance(p, "ins_site").index = 1;
      }),
    ).toEqual([]);
  });

  it("reports a second row with the same code", () => {
    const results = check((p) => {
      row(p, "map_label").code = "R-001";
    });
    expect(only(IntegrityCode.DUPLICATE_ROW_CODE, results)).toEqual([
      expect.objectContaining({ id: "map_label", field: "code" }),
    ]);
  });
});

describe("rule 3: rows and roles use the columns of their own table", () => {
  it("reports a row column from another table", () => {
    const results = check((p) => {
      row(p, "map_pid").columnId = "col_sid";
    });
    expect(only(IntegrityCode.SOURCE_MISMATCH, results)).toEqual([
      expect.objectContaining({ objectKind: "mapping", id: "map_pid", field: "columnId" }),
    ]);
  });

  it.each<[string, (p: ProjectFile) => void, string, string]>([
    [
      "a unit column",
      (p) => {
        row(p, "map_hb").transform = { kind: "quantity", unitColumnId: "col_adm" };
      },
      "map_hb",
      "transform.unitColumnId",
    ],
    [
      "a role id rule column",
      (p) => {
        instance(p, "ins_patient").idRule = {
          parts: [{ literal: "pat" }, { columnId: "col_sid" }],
        };
      },
      "ins_patient",
      "idRule.parts.1.columnId",
    ],
    [
      "a per-value column",
      (p) => {
        instance(p, "ins_site").multiplicity = { kind: "perValue", columnId: "col_adm" };
      },
      "ins_site",
      "multiplicity.columnId",
    ],
    [
      "a row key column",
      (p) => {
        at(p.sources, 0).rowKey = ["col_sid"];
      },
      "src_patient",
      "rowKey.0",
    ],
    [
      "a relation column",
      (p) => {
        at(p.sourceRelations ?? [], 0).from.columnIds = ["col_pid"];
      },
      "rel_stay_patient",
      "from.columnIds.0",
    ],
    [
      "a section of another table",
      (p) => {
        at(p.sources, 1).sections = [{ id: "sec_stay", name: "Stay" }];
        at(at(p.sources, 0).columns, 1).sectionId = "sec_stay";
      },
      "col_sex",
      "sectionId",
    ],
  ])("reports %s from another table", (_name, mutate, id, field) => {
    expect(only(IntegrityCode.SOURCE_MISMATCH, check(mutate))).toEqual([
      expect.objectContaining({ id, field }),
    ]);
  });

  it("accepts a reference row of a role in another table (checked by rule 5)", () => {
    // map_stay_subj: role in src_stay, target in src_patient, via the relation.
    expect(
      only(
        IntegrityCode.SOURCE_MISMATCH,
        check(() => undefined),
      ),
    ).toEqual([]);
  });
});
