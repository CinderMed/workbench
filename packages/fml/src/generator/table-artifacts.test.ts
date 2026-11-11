import { isProjectFile, validateNormalizationSchema, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraModel from "../../../../fixtures/fml-examples/metastra/StructureDefinition-FirstOverviewRow.json?raw";
import metastraNormalization from "../../../../fixtures/fml-examples/metastra/normalization-FirstOverview.json?raw";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import fallModel from "../../../../fixtures/fml-examples/motu/StructureDefinition-FallRow.json?raw";
import stayModel from "../../../../fixtures/fml-examples/motu/StructureDefinition-HospitalStayRow.json?raw";
import patientModel from "../../../../fixtures/fml-examples/motu/StructureDefinition-MotuPatientRow.json?raw";
import fallNormalization from "../../../../fixtures/fml-examples/motu/normalization-Fall.json?raw";
import stayNormalization from "../../../../fixtures/fml-examples/motu/normalization-HospitalStay.json?raw";
import patientNormalization from "../../../../fixtures/fml-examples/motu/normalization-MotuPatient.json?raw";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { GeneratorCode, GeneratorInputError } from "./codes.js";
import { logicalModel } from "./logical-model.js";
import { normalizationSpec } from "./normalization-spec.js";
import { planTable, type TablePlan } from "./table-plan.js";

function project(document: unknown): ProjectFile {
  if (!isProjectFile(document)) throw new Error("fixture is not a valid project");
  return document;
}

const metastra = project(metastraProject);
const motu = project(motuProject);
const fixtureSchemaRef = "../normalization.schema.json";

function plan(file: ProjectFile, sourceId: string): TablePlan {
  const planned = planTable(file, sourceId);
  if (!planned.ok) throw new Error(JSON.stringify(planned.results));
  return planned.value;
}

/** Canonical serialization of the verified examples: two-space indent, no final newline. */
const serialize = (value: unknown): string => JSON.stringify(value, null, 2);

const cases = [
  ["metastra", metastra, "src_firstoverview", metastraModel, metastraNormalization],
  ["MOTU MotuPatient", motu, "src_patient", patientModel, patientNormalization],
  ["MOTU HospitalStay", motu, "src_stay", stayModel, stayNormalization],
  ["MOTU Fall", motu, "src_fall", fallModel, fallNormalization],
] as const;

describe.each(cases)("%s", (_name, file, sourceId, expectedModel, expectedNormalization) => {
  const planned = plan(file, sourceId);

  it("produces the verified logical model, byte for byte", () => {
    expect(serialize(logicalModel(file, planned))).toBe(expectedModel);
  });

  it("produces the verified normalization specification, byte for byte", () => {
    const spec = normalizationSpec(file, planned, { schemaRef: fixtureSchemaRef });
    expect(serialize(spec)).toBe(expectedNormalization);
  });

  it("produces a normalization specification valid for its schema", () => {
    expect(validateNormalizationSchema(normalizationSpec(file, planned))).toEqual([]);
  });
});

describe("planTable", () => {
  it("computes the id of a role in another table from the columns paired by the relation", () => {
    const fall = plan(motu, "src_fall");
    expect(
      fall.idFields.map((f) => [f.field, f.referenced, f.columns.map((c) => c.element)]),
    ).toEqual([
      ["id_AdverseEvent0", false, ["AnonymousID", "AdmissionDate", "FallDate"]],
      ["id_Patient0", true, ["AnonymousID"]],
      ["id_Encounter0", true, ["AnonymousID", "AdmissionDate"]],
    ]);
  });

  it("writes no $schema unless asked", () => {
    expect(normalizationSpec(motu, plan(motu, "src_fall"))).not.toHaveProperty("$schema");
  });

  it("writes onInvalidValue from the project, fail by default", () => {
    const changed = structuredCopy(motu);
    expect(normalizationSpec(changed, plan(changed, "src_fall")).onInvalidValue).toBe(
      "report-drop",
    );
    delete changed.project.output?.onInvalidValue;
    expect(normalizationSpec(changed, plan(changed, "src_fall")).onInvalidValue).toBe("fail");
    delete changed.project.output;
    expect(normalizationSpec(changed, plan(changed, "src_fall")).onInvalidValue).toBe("fail");
  });

  it("writes decimalSeparator only when the column declares it", () => {
    const changed = structuredCopy(metastra);
    const hb = changed.sources[0].columns.find((c) => c.name === "obs_bloodt_hb");
    if (hb === undefined) throw new Error("fixture changed");
    expect(columnOf(changed, "obs_bloodt_hb")).not.toHaveProperty("decimalSeparator");
    hb.decimalSeparator = ",";
    expect(columnOf(changed, "obs_bloodt_hb")).toEqual({
      name: "obs_bloodt_hb",
      sourceName: "obs_bloodt_hb",
      type: "decimal",
      decimalSeparator: ",",
      missingValues: ["NA"],
    });
  });

  it("writes the allowed values of categorical and multiple-choice columns", () => {
    expect(columnOf(metastra, "proc_surg_loc")).toEqual({
      name: "proc_surg_loc",
      sourceName: "proc_surg_loc",
      type: "string",
      allowedValues: ["1", "2", "8", "20"],
      multiValue: { separator: "," },
    });
    expect(columnOf(metastra, "patient_gender")).toHaveProperty("allowedValues", [
      "Female",
      "Male",
    ]);
    expect(columnOf(metastra, "obs_bloodt_hb")).not.toHaveProperty("allowedValues");
  });

  it("uses the R5 base for R5 projects", () => {
    const r5 = { ...motu, project: { ...motu.project, fhirVersion: "5.0.0" as const } };
    const model = logicalModel(r5, plan(r5, "src_patient"));
    expect(model.fhirVersion).toBe("5.0.0");
    expect(model.baseDefinition).toBe("http://hl7.org/fhir/StructureDefinition/Base");
  });

  it("gives way to id field names when a column would collide with one", () => {
    const renamed = structuredCopy(motu);
    const column = renamed.sources[0].columns[1];
    if (column === undefined) throw new Error("fixture changed");
    column.name = "id_Patient0";
    const patient = plan(renamed, "src_patient");
    expect(patient.columns[1]?.element).toBe("id_Patient02");
    expect(patient.idFields[0]?.field).toBe("id_Patient0");
  });

  it("never gives a column the names id, extension or resourceType", () => {
    const changed = structuredCopy(motu);
    const [first, second, third] = changed.sources[0].columns;
    if (second === undefined || third === undefined) throw new Error("fixture changed");
    first.name = "id";
    second.name = "extension";
    third.name = "resourceType";
    const planned = plan(changed, "src_patient");
    expect(planned.columns.map((c) => c.element)).toEqual(["id2", "extension2", "resourceType2"]);
    const paths = logicalModel(changed, planned).snapshot.element.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "MotuPatientRow.id2",
        "MotuPatientRow.extension2",
        "MotuPatientRow.resourceType2",
      ]),
    );
    expect(paths).not.toEqual(expect.arrayContaining(["MotuPatientRow.id"]));
    // The data file is still read with the original headers.
    const spec = normalizationSpec(changed, planned);
    expect(spec.columns.map((c) => [c.name, c.sourceName])).toEqual([
      ["id2", "id"],
      ["extension2", "extension"],
      ["resourceType2", "resourceType"],
    ]);
  });

  it("rejects a table name that is not a valid FML name", () => {
    const renamed = structuredCopy(motu);
    renamed.sources[0].name = "Motu Patient";
    expect(planTable(renamed, "src_patient")).toEqual({
      ok: false,
      results: [
        expect.objectContaining({
          code: GeneratorCode.SOURCE_NAME_NOT_FML_NAME,
          objectKind: "source",
          id: "src_patient",
          field: "name",
        }),
      ],
    });
  });

  it("rejects multiple choices spread over several columns (B9, V2)", () => {
    const changed = structuredCopy(metastra);
    const column = changed.sources[0].columns.find((c) => c.dataType === "multipleChoice");
    if (column === undefined) throw new Error("fixture changed");
    column.multiValue = {
      encoding: "expanded",
      columns: [{ value: "1", originalName: "proc_surg_loc___1" }],
    };
    const planned = planTable(changed, "src_firstoverview");
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.results).toEqual([
      expect.objectContaining({
        code: GeneratorCode.MULTI_VALUE_EXPANDED_UNSUPPORTED,
        objectKind: "column",
        id: column.id,
      }),
    ]);
  });

  it("rejects a role without id rule", () => {
    const changed = structuredCopy(motu);
    const role = changed.instances.find((i) => i.id === "ins_patient0");
    if (role === undefined) throw new Error("fixture changed");
    delete role.idRule;
    const planned = planTable(changed, "src_patient");
    expect(planned.ok ? [] : planned.results).toEqual([
      expect.objectContaining({
        code: GeneratorCode.ROLE_WITHOUT_ID_RULE,
        objectKind: "instance",
        id: "ins_patient0",
        field: "idRule",
      }),
    ]);
  });

  it("rejects a literal part after a column part", () => {
    const changed = structuredCopy(motu);
    const role = changed.instances.find((i) => i.id === "ins_patient0");
    if (role?.idRule === undefined) throw new Error("fixture changed");
    role.idRule.parts.push({ literal: "x" });
    const planned = planTable(changed, "src_patient");
    expect(planned.ok ? [] : planned.results).toEqual([
      expect.objectContaining({
        code: GeneratorCode.ID_LITERAL_AFTER_COLUMN,
        field: "idRule.parts.2",
      }),
    ]);
  });

  it("rejects an id rule without column parts", () => {
    const changed = structuredCopy(motu);
    const role = changed.instances.find((i) => i.id === "ins_patient0");
    if (role?.idRule === undefined) throw new Error("fixture changed");
    role.idRule.parts = [{ literal: "pat" }];
    const planned = planTable(changed, "src_patient");
    expect(planned.ok ? [] : planned.results).toEqual([
      expect.objectContaining({
        code: GeneratorCode.ID_RULE_WITHOUT_COLUMNS,
        id: "ins_patient0",
        field: "idRule.parts",
      }),
    ]);
  });

  it("never writes empty strings: an empty description or label falls back to the next value", () => {
    const changed = structuredCopy(motu);
    const [first, second] = changed.sources[0].columns;
    if (second === undefined) throw new Error("fixture changed");
    first.description = "";
    second.description = "";
    second.label = "";
    const elements = logicalModel(changed, plan(changed, "src_patient")).snapshot.element;
    expect(elements[1]).toMatchObject({ short: "AnonymousID", definition: "AnonymousID" });
    expect(elements[2]).toMatchObject({ short: "Sex", definition: "Sex" });
  });

  it("throws on projects that break the integrity rules", () => {
    expect(() => planTable(motu, "src_unknown")).toThrow(GeneratorInputError);
    const dangling = structuredCopy(motu);
    const row = dangling.mappings.find(
      (m) => m.transform.kind === "reference" && m.transform.via === "rel_fall_patient",
    );
    if (row?.transform.kind !== "reference") throw new Error("fixture changed");
    row.transform.via = "rel_missing";
    expect(() => planTable(dangling, "src_fall")).toThrow(/Unknown source relation/);
  });
});

function structuredCopy(file: ProjectFile): ProjectFile {
  return JSON.parse(JSON.stringify(file)) as ProjectFile;
}

function columnOf(file: ProjectFile, name: string): unknown {
  return normalizationSpec(file, plan(file, "src_firstoverview")).columns.find(
    (c) => c.name === name,
  );
}
