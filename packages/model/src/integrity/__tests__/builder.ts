// Fixture-free test project: two tables linked by a relation, roles in both, and at least one
// object for every `…Id` field, so each integrity rule has something to break.
import type { ProjectFile } from "../../generated/project.js";

export function cleanProject(): ProjectFile {
  return {
    formatVersion: "1.2.0",
    project: {
      id: "prj_test",
      name: "Integrity test",
      fhirVersion: "4.0.1",
      canonicalBase: "https://example.org/fhir",
    },
    sources: [
      {
        id: "src_patient",
        name: "patients",
        rowKey: ["col_pid"],
        sections: [{ id: "sec_demo", name: "Demographics" }],
        columns: [
          { id: "col_pid", name: "patient_id", dataType: "string", sectionId: "sec_demo" },
          {
            id: "col_sex",
            name: "sex",
            dataType: "categorical",
            allowedValues: [{ code: "M" }, { code: "F" }],
            missingValues: ["99"],
          },
          {
            id: "col_sites",
            name: "sites",
            dataType: "multipleChoice",
            multiValue: { encoding: "delimited", separator: "," },
            allowedValues: [{ code: "1" }, { code: "2" }],
          },
          { id: "col_hb", name: "hb", dataType: "decimal" },
          {
            id: "col_hb_unit",
            name: "hb_unit",
            dataType: "categorical",
            allowedValues: [{ code: "1" }, { code: "2" }],
            review: {
              status: "draft",
              comments: [
                { id: "cmt_first", author: "a", createdAt: "2026-11-11T10:00:00Z", text: "unit?" },
                {
                  id: "cmt_reply",
                  author: "b",
                  createdAt: "2026-11-11T11:00:00Z",
                  text: "g/dL",
                  replyTo: "cmt_first",
                },
              ],
            },
          },
        ],
      },
      {
        id: "src_stay",
        name: "stays",
        rowKey: ["col_sid", "col_adm"],
        columns: [
          { id: "col_sid", name: "patient_id", dataType: "string" },
          { id: "col_adm", name: "admission", dataType: "date" },
        ],
      },
    ],
    sourceRelations: [
      {
        id: "rel_stay_patient",
        from: { sourceId: "src_stay", columnIds: ["col_sid"] },
        to: { sourceId: "src_patient", columnIds: ["col_pid"] },
      },
    ],
    instances: [
      {
        id: "ins_patient",
        resourceType: "Patient",
        index: 0,
        sourceId: "src_patient",
        multiplicity: { kind: "perRow" },
        idRule: { parts: [{ literal: "pat" }, { columnId: "col_pid" }] },
      },
      {
        id: "ins_obs",
        resourceType: "Observation",
        index: 0,
        sourceId: "src_patient",
        multiplicity: { kind: "perRow" },
        context: { patientInstanceId: "ins_patient" },
        createWhen: {
          op: "and",
          conditions: [
            { op: "notEmpty", columnId: "col_hb" },
            { op: "not", condition: { op: "equals", columnId: "col_sex", value: "99" } },
          ],
        },
        idRule: {
          parts: [{ literal: "obs-hb" }, { columnId: "col_pid" }],
          encoding: "hash",
          hashLength: 24,
        },
        slices: [
          {
            id: "slc_nrs",
            path: "component",
            name: "nrs",
            discriminator: [{ path: "code", value: { type: "code", value: "nrs" } }],
          },
        ],
        fixedValues: [
          { path: "component[nrs].code.text", value: { type: "string", value: "NRS" } },
        ],
      },
      {
        id: "ins_site",
        resourceType: "Condition",
        index: 0,
        sourceId: "src_patient",
        multiplicity: { kind: "perValue", columnId: "col_sites" },
        idRule: {
          parts: [{ literal: "site" }, { columnId: "col_pid" }, { columnId: "col_sites" }],
        },
      },
      {
        id: "ins_stay",
        resourceType: "Encounter",
        index: 0,
        sourceId: "src_stay",
        multiplicity: { kind: "perGroup", groupBy: ["col_sid", "col_adm"] },
        idRule: {
          parts: [{ literal: "enc" }, { columnId: "col_sid" }, { columnId: "col_adm" }],
          encoding: "sanitize",
          separator: ".",
        },
        templateId: "tpl_visit",
      },
    ],
    mappings: [
      {
        id: "map_pid",
        code: "R-001",
        columnId: "col_pid",
        instanceId: "ins_patient",
        path: "identifier.value",
        transform: { kind: "copy" },
      },
      {
        id: "map_sex",
        code: "R-002",
        columnId: "col_sex",
        instanceId: "ins_patient",
        path: "gender",
        transform: { kind: "valueMap", valueMapId: "vm_sex" },
      },
      {
        id: "map_hb",
        code: "R-003",
        columnId: "col_hb",
        instanceId: "ins_obs",
        path: "component[nrs].valueQuantity",
        transform: {
          kind: "quantity",
          unitColumnId: "col_hb_unit",
          unitValueMapId: "vm_hb_unit",
        },
        condition: { op: "in", columnId: "col_sex", values: ["M", "F"] },
      },
      {
        id: "map_sites",
        code: "R-004",
        columnId: "col_sites",
        instanceId: "ins_site",
        path: "bodySite",
        transform: { kind: "valueMap", valueMapId: "vm_sites" },
        repeat: { kind: "eachValue" },
      },
      {
        id: "map_obs_subj",
        code: "R-005",
        instanceId: "ins_obs",
        path: "subject",
        transform: { kind: "reference", targetInstanceId: "ins_patient", auto: true },
      },
      {
        id: "map_stay_subj",
        code: "R-006",
        instanceId: "ins_stay",
        path: "subject",
        transform: {
          kind: "reference",
          targetInstanceId: "ins_patient",
          via: "rel_stay_patient",
        },
      },
      {
        id: "map_label",
        code: "R-007",
        instanceId: "ins_stay",
        path: "type.text",
        transform: { kind: "concat", columnIds: ["col_sid", "col_adm"], separator: " " },
      },
    ],
    valueMaps: [
      {
        id: "vm_sex",
        name: "sex",
        target: "code",
        entries: [
          { sourceValue: "M", target: { value: "male" }, action: { kind: "use" } },
          { sourceValue: "F", target: { value: "female" }, action: { kind: "use" } },
          { sourceValue: "99", action: { kind: "absent" } },
        ],
      },
      {
        id: "vm_hb_unit",
        name: "hbUnit",
        target: "Quantity.unit",
        entries: [
          {
            sourceValue: "1",
            target: { system: "http://unitsofmeasure.org", code: "g/dL" },
            action: {
              kind: "use",
              also: [{ path: "component[nrs].code.text", value: { type: "string", value: "Hb" } }],
            },
          },
          {
            sourceValue: "2",
            action: {
              kind: "setElement",
              set: [{ path: "status", value: { type: "code", value: "preliminary" } }],
            },
          },
        ],
      },
      {
        id: "vm_sites",
        name: "sites",
        target: "CodeableConcept",
        entries: [
          {
            sourceValue: "1",
            target: { system: "http://snomed.info/sct", code: "123037004" },
            action: { kind: "use" },
          },
          { sourceValue: "2", action: { kind: "skipInstance" } },
        ],
      },
    ],
    templates: [
      {
        id: "tpl_visit",
        name: "visit",
        instanceIds: ["ins_stay"],
        parameters: [{ name: "suffix", kind: "columnSuffix" }],
        applications: [{ id: "app_second", label: "second visit", arguments: { suffix: "_2" } }],
      },
    ],
  };
}
