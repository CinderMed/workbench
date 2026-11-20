/**
 * Tests only: a tiny R4 definition index (Patient with `active` and `name`, HumanName and a few
 * primitives) built with `@cindermed/fhir-defs`, served through an in-memory `fetch`, as the dev
 * server serves `cindermed fhir-index` output. Enough to show the boolean on Patient.name.
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
        ...["string", "boolean", "code", "uri", "integer"].map((p) =>
          sd(p, "primitive-type", { [p]: {} }),
        ),
        sd("HumanName", "complex-type", {
          HumanName: {},
          "HumanName.family": { type: [{ code: "string" }] },
          "HumanName.text": { type: [{ code: "string" }] },
        }),
        sd("Patient", "resource", {
          Patient: {},
          "Patient.active": { type: [{ code: "boolean" }] },
          "Patient.name": { max: "*", type: [{ code: "HumanName" }] },
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
