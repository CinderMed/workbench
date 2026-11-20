/**
 * Tests only: a tiny R4 definition index (Patient with `active` and `name`, Observation with its
 * repeating `component`, HumanName, CodeableConcept, Coding and a few primitives) built with
 * `@cindermed/fhir-defs`, served through an in-memory `fetch`, as the dev server serves
 * `cindermed fhir-index` output. Enough to show the boolean on Patient.name and a named slice.
 */
import { FhirDefinitions, type IndexFetch, buildIndex } from "@cindermed/fhir-defs";
import type { ProjectFile } from "@cindermed/model";

const FHIR = "http://hl7.org/fhir/StructureDefinition/";

function sd(name: string, kind: string, elements: Record<string, Record<string, unknown>>) {
  return {
    resourceType: "StructureDefinition",
    id: name,
    url: `${FHIR}${name}`,
    name,
    type: name,
    kind,
    abstract: false,
    derivation: "specialization",
    snapshot: {
      element: Object.entries(elements).map(([path, fields]) => ({
        id: path,
        path,
        min: 0,
        max: "1",
        ...fields,
      })),
    },
  };
}

export function syntheticDefinitions(): { defs: FhirDefinitions; fetch: IndexFetch } {
  const built = buildIndex("4.0.1", [
    {
      id: "hl7.fhir.r4.core",
      version: "4.0.1",
      fhirVersions: ["4.0.1"],
      resources: [
        { ...sd("Resource", "resource", { Resource: {} }), abstract: true, derivation: undefined },
        ...["string", "boolean", "code", "uri", "integer", "decimal"].map((p) =>
          sd(p, "primitive-type", { [p]: {} }),
        ),
        sd("HumanName", "complex-type", {
          HumanName: {},
          "HumanName.family": { type: [{ code: "string" }] },
          "HumanName.text": { type: [{ code: "string" }] },
        }),
        sd("Coding", "complex-type", {
          Coding: {},
          "Coding.system": { type: [{ code: "uri" }] },
          "Coding.code": { type: [{ code: "code" }] },
          "Coding.display": { type: [{ code: "string" }] },
        }),
        sd("CodeableConcept", "complex-type", {
          CodeableConcept: {},
          "CodeableConcept.coding": { max: "*", type: [{ code: "Coding" }] },
          "CodeableConcept.text": { type: [{ code: "string" }] },
        }),
        sd("Observation", "resource", {
          Observation: {},
          "Observation.status": { min: 1, type: [{ code: "code" }] },
          "Observation.code": { min: 1, type: [{ code: "CodeableConcept" }] },
          "Observation.component": { max: "*", type: [{ code: "BackboneElement" }] },
          "Observation.component.code": { min: 1, type: [{ code: "CodeableConcept" }] },
          "Observation.component.value[x]": {
            type: [{ code: "integer" }, { code: "string" }],
          },
        }),
        sd("Patient", "resource", {
          Patient: {},
          "Patient.active": { type: [{ code: "boolean" }] },
          "Patient.name": { max: "*", type: [{ code: "HumanName" }] },
          "Patient.contact": { max: "*", type: [{ code: "BackboneElement" }] },
          "Patient.contact.name": { type: [{ code: "HumanName" }] },
          "Patient.contact.relationship": { max: "*", type: [{ code: "string" }] },
        }),
      ],
    },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  const files = new Map([["index.json", built.value.manifestText], ...built.value.files]);
  const fetch: IndexFetch = (file) => {
    const text = files.get(file);
    return text === undefined ? Promise.reject(new Error(`${file}: 404`)) : Promise.resolve(text);
  };
  const opened = FhirDefinitions.open(built.value.manifest);
  if (!opened.ok) throw new Error("index not opened");
  return { defs: opened.value, fetch };
}

/** A patient table: a boolean column copied to Patient.active (fine) and to Patient.name (wrong). */
export function patientProject(): ProjectFile {
  return {
    formatVersion: "1.4.0",
    project: {
      id: "prj_pat001",
      name: "Patients",
      fhirVersion: "4.0.1",
      canonicalBase: "https://cindermed.org/fhir/p",
    },
    sources: [
      {
        id: "src_pat001",
        name: "Patients",
        columns: [{ id: "col_flag01", name: "flag", dataType: "boolean" }],
      },
    ],
    instances: [
      {
        id: "ins_pat001",
        resourceType: "Patient",
        index: 0,
        sourceId: "src_pat001",
        multiplicity: { kind: "perRow" },
      },
    ],
    mappings: [
      {
        id: "map_active",
        code: "R-001",
        columnId: "col_flag01",
        instanceId: "ins_pat001",
        path: "active",
        transform: { kind: "copy" },
      },
      {
        id: "map_name01",
        code: "R-002",
        columnId: "col_flag01",
        instanceId: "ins_pat001",
        path: "name",
        transform: { kind: "copy" },
      },
    ],
    valueMaps: [],
  };
}

/** A pain table: a score (integer) for an Observation with a repeating `component` (D4). */
export function painProject(): ProjectFile {
  return {
    formatVersion: "1.4.0",
    project: {
      id: "prj_pain01",
      name: "Pain",
      fhirVersion: "4.0.1",
      canonicalBase: "https://cindermed.org/fhir/p",
    },
    sources: [
      {
        id: "src_pain01",
        name: "Pain",
        columns: [{ id: "col_nrs001", name: "nrs", dataType: "integer" }],
      },
    ],
    instances: [
      {
        id: "ins_obs001",
        resourceType: "Observation",
        index: 0,
        sourceId: "src_pain01",
        multiplicity: { kind: "perRow" },
      },
    ],
    mappings: [
      {
        id: "map_nrs001",
        code: "R-001",
        columnId: "col_nrs001",
        instanceId: "ins_obs001",
        path: "component",
        transform: { kind: "copy" },
      },
    ],
    valueMaps: [],
  };
}
