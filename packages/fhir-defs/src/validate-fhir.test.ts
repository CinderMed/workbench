import type { Instance, MappingRow, ProjectFile, ValueMap } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { FHIR, r4Paths } from "./test-support/synthetic-packages.js";
import { FhirCode, loadProjectDefinitions, validateFhir } from "./validate-fhir.js";

function definitions(loaded = true) {
  const index = buildIndex("4.0.1", [r4Paths()]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  if (loaded) for (const [file, text] of index.value.files) opened.value.add(file, text);
  return { defs: opened.value, files: index.value.files };
}

const { defs } = definitions();

function project(
  parts: { instances?: Instance[]; mappings?: MappingRow[]; valueMaps?: ValueMap[] },
  fhirVersion: ProjectFile["project"]["fhirVersion"] = "4.0.1",
): ProjectFile {
  return {
    formatVersion: "1.3.0",
    project: { id: "prj", name: "Test", fhirVersion, canonicalBase: "http://example.org/fhir" },
    sources: [{ id: "src", name: "T", columns: [{ id: "col", name: "c", dataType: "string" }] }],
    instances: parts.instances ?? [observation()],
    mappings: parts.mappings ?? [],
    valueMaps: parts.valueMaps ?? [],
  };
}

function observation(extra: Partial<Instance> = {}): Instance {
  return {
    id: "ins_obs",
    resourceType: "Observation",
    index: 0,
    sourceId: "src",
    multiplicity: { kind: "perRow" },
    ...extra,
  };
}

function row(n: number, path: string, extra: Partial<MappingRow> = {}): MappingRow {
  return {
    id: `map_${String(n)}`,
    code: `R-00${String(n)}`,
    instanceId: "ins_obs",
    columnId: "col",
    path,
    transform: { kind: "copy" },
    ...extra,
  };
}

const status = { type: "code", value: "final" } as const;

describe("validateFhir", () => {
  it("accepts paths that resolve", () => {
    const valueMap: ValueMap = {
      id: "vm",
      name: "codes",
      target: "Coding",
      entries: [
        {
          sourceValue: "a",
          action: { kind: "setElement", set: [{ path: "status", value: status }] },
        },
        {
          sourceValue: "b",
          target: { system: "http://example.org", code: "b" },
          action: {
            kind: "use",
            also: [{ path: "code.text", value: { type: "string", value: "b" } }],
          },
        },
      ],
    };
    const ok = project({
      instances: [
        observation({
          fixedValues: [{ path: "status", value: status }],
          slices: [
            {
              id: "sl",
              path: "component",
              name: "nrs",
              discriminator: [{ path: "code.text", value: { type: "string", value: "NRS" } }],
            },
          ],
        }),
      ],
      mappings: [
        row(1, "code.coding.code"),
        row(2, "valueQuantity.value"),
        row(3, "component[nrs].valueInteger"),
        row(4, "code.coding", {
          transform: { kind: "valueMap", valueMapId: "vm" },
          repeat: { kind: "eachValue" },
        }),
        row(5, "subject", { transform: { kind: "reference", targetInstanceId: "ins_obs" } }),
      ],
      valueMaps: [valueMap],
    });
    expect(validateFhir(ok, defs)).toEqual([]);
  });

  it.each([
    [
      "nothing",
      FhirCode.PATH_NOT_FOUND,
      "R-001: Observation.nothing: nothing is not an element of Observation",
    ],
    [
      "value",
      FhirCode.CHOICE_TYPE_REQUIRED,
      "R-001: Observation.value: value is a choice: use one of valueQuantity, valueString, valueBoolean",
    ],
    [
      "code[local]",
      FhirCode.SLICE_NOT_REPEATING,
      "R-001: Observation.code[local]: code[local]: code does not repeat (max 1), so it cannot have named slices",
    ],
    [
      "valueQuantity.extension",
      FhirCode.EXTENSION_NOT_SUPPORTED,
      "R-001: Observation.valueQuantity.extension: extension: extensions cannot be mapped",
    ],
  ])("reports the row path %s as %s", (path, code, message) => {
    expect(validateFhir(project({ mappings: [row(1, path)] }), defs)).toEqual([
      { severity: "error", code, objectKind: "mapping", id: "map_1", field: "path", message },
    ]);
  });

  it("reports repeat eachValue towards an element that does not repeat (rule 8)", () => {
    const results = validateFhir(
      project({ mappings: [row(1, "status", { repeat: { kind: "eachValue" } })] }),
      defs,
    );
    expect(results).toEqual([
      {
        severity: "error",
        code: FhirCode.REPEAT_TARGET_NOT_REPEATING,
        objectKind: "mapping",
        id: "map_1",
        field: "repeat",
        message:
          "R-001: Observation.status: repeat eachValue writes one repetition per value, but Observation.status does not repeat (max 1)",
      },
    ]);
  });

  it("checks fixed values, slice declarations and their discriminators on the role (rule 4)", () => {
    const results = validateFhir(
      project({
        instances: [
          observation({
            fixedValues: [{ path: "stat", value: status }],
            slices: [
              {
                id: "s1",
                path: "code",
                name: "one",
                discriminator: [{ path: "text", value: { type: "string", value: "x" } }],
              },
              {
                id: "s2",
                path: "component",
                name: "two",
                discriminator: [{ path: "kode", value: { type: "string", value: "x" } }],
              },
            ],
          }),
        ],
      }),
      defs,
    );
    expect(results.map((r) => [r.code, r.objectKind, r.id, r.field])).toEqual([
      [FhirCode.SLICE_NOT_REPEATING, "instance", "ins_obs", "slices.0.path"],
      [FhirCode.SLICE_NOT_REPEATING, "instance", "ins_obs", "slices.0.discriminator.0.path"],
      [FhirCode.PATH_NOT_FOUND, "instance", "ins_obs", "slices.1.discriminator.0.path"],
      [FhirCode.PATH_NOT_FOUND, "instance", "ins_obs", "fixedValues.0.path"],
    ]);
    expect(results[2]?.message).toBe(
      "discriminator of slice component[two]: Observation.component[two].kode: kode is not an element of Observation.component",
    );
    expect(results[3]?.message).toBe(
      "fixed value: Observation.stat: stat is not an element of Observation",
    );
  });

  it("checks the elements value actions set, once per value map", () => {
    const valueMap: ValueMap = {
      id: "vm",
      name: "codes",
      target: "Coding",
      entries: [
        {
          sourceValue: "a",
          action: { kind: "setElement", set: [{ path: "statuz", value: status }] },
        },
      ],
    };
    const used = { transform: { kind: "valueMap", valueMapId: "vm" } } as const;
    const results = validateFhir(
      project({
        mappings: [row(1, "code.coding", used), row(2, "code.coding", used)],
        valueMaps: [valueMap],
      }),
      defs,
    );
    expect(results).toEqual([
      {
        severity: "error",
        code: FhirCode.PATH_NOT_FOUND,
        objectKind: "valueMap",
        id: "vm",
        field: "entries.0.action.set.0.path",
        message:
          "value map codes (used by R-001): Observation.statuz: statuz is not an element of Observation",
      },
    ]);
  });

  it("resolves paths in the role's profile", () => {
    const results = validateFhir(
      project({
        instances: [observation({ profile: `${FHIR}vitalsigns` })],
        mappings: [row(1, "method"), row(2, "category[VSCat].coding")],
      }),
      defs,
    );
    expect(results.map((r) => [r.code, r.id])).toEqual([[FhirCode.PATH_PROHIBITED, "map_1"]]);
    expect(results[0]?.message).toBe(
      `R-001: Observation.method: method is prohibited by ${FHIR}vitalsigns`,
    );
  });

  it("checks the role's resource type and profile", () => {
    const results = validateFhir(
      project({
        instances: [
          observation({ id: "a", resourceType: "Observasion" }),
          observation({
            id: "b",
            index: 1,
            profile: "http://example.org/StructureDefinition/unknown",
          }),
          observation({ id: "c", index: 2, profile: `${FHIR}SimpleQuantity` }),
          observation({ id: "d", index: 3, resourceType: "Patient", profile: `${FHIR}vitalsigns` }),
        ],
        mappings: [
          row(1, "nothing", { instanceId: "a" }),
          row(2, "method", { instanceId: "b" }),
          row(3, "x", { instanceId: "missing" }),
        ],
      }),
      defs,
    );
    expect(results.map((r) => [r.code, r.id, r.field, r.message])).toEqual([
      [
        FhirCode.RESOURCE_TYPE_UNKNOWN,
        "a",
        "resourceType",
        "Observasion[0]: Observasion is not a resource type of FHIR 4.0.1",
      ],
      [
        FhirCode.PROFILE_UNKNOWN,
        "b",
        "profile",
        "Observation[1]: profile http://example.org/StructureDefinition/unknown is not in the core package or the project's packages",
      ],
      [
        FhirCode.PROFILE_TYPE_MISMATCH,
        "c",
        "profile",
        `Observation[2]: profile ${FHIR}SimpleQuantity constrains Quantity, not Observation`,
      ],
      [
        FhirCode.PROFILE_TYPE_MISMATCH,
        "d",
        "profile",
        `Patient[3]: profile ${FHIR}vitalsigns constrains Observation, not Patient`,
      ],
      // An unknown profile: the role's paths are still checked, on the base resource type.
      [
        FhirCode.PATH_NOT_FOUND,
        "map_2",
        "path",
        "R-002: Observation.method: method is not an element of Observation",
      ],
    ]);
  });

  it("refuses definitions of another FHIR version", () => {
    expect(validateFhir(project({}, "5.0.0"), defs)).toEqual([
      {
        severity: "error",
        code: FhirCode.FHIR_VERSION_MISMATCH,
        objectKind: "project",
        id: "prj",
        field: "project.fhirVersion",
        message: "the project is for FHIR 5.0.0, the definitions are for FHIR 4.0.1",
      },
    ]);
  });

  it("reports definitions that are not loaded instead of guessing", () => {
    const results = validateFhir(project({ mappings: [row(1, "code")] }), definitions(false).defs);
    expect(results.map((r) => r.code)).toEqual([FhirCode.DEFINITION_NOT_LOADED]);
  });
});

describe("loadProjectDefinitions", () => {
  it("loads only the documents the project needs, then validates as with everything loaded", async () => {
    const { defs: empty, files } = definitions(false);
    const asked: string[] = [];
    const fetch = (file: string) => {
      asked.push(file);
      return Promise.resolve(files.get(file) ?? "");
    };
    const p = project({
      instances: [
        observation({ profile: `${FHIR}vitalsigns` }),
        observation({ id: "q", index: 1, resourceType: "Questionnaire" }),
      ],
      mappings: [
        row(1, "category.coding.code"),
        row(2, "method"),
        row(3, "item.item.linkId", { instanceId: "q" }),
      ],
    });
    await loadProjectDefinitions(p, empty, fetch);
    expect(asked.sort()).toEqual([
      "profiles/hl7.fhir.r4.core/vitalsigns.json",
      "types/CodeableConcept.json",
      "types/Coding.json",
      "types/Observation.json",
      "types/Questionnaire.json",
    ]);
    expect(validateFhir(p, empty)).toEqual(validateFhir(p, defs));
    expect(validateFhir(p, empty).map((r) => r.code)).toEqual([FhirCode.PATH_PROHIBITED]);
  });
});
