/** Synthetic FHIR packages for the fhir-defs tests: small, but every index rule is exercised. */
import type { PackageContents } from "../build-index.js";

export const FHIR = "http://hl7.org/fhir/StructureDefinition/";

/** A StructureDefinition with a snapshot made of these elements (path → extra fields). */
export function sd(
  name: string,
  kind: string,
  elements: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...extra,
  };
}

/** A small R4 core package: enough types to exercise every rule of the index. */
export function r4Core(extra: unknown[] = []): PackageContents {
  return {
    id: "hl7.fhir.r4.core",
    version: "4.0.1",
    fhirVersions: ["4.0.1"],
    resources: [
      sd(
        "Resource",
        "resource",
        { Resource: { max: "*" } },
        { abstract: true, derivation: undefined },
      ),
      sd("string", "primitive-type", { string: {} }),
      sd("uri", "primitive-type", { uri: {} }),
      sd("code", "primitive-type", { code: {} }),
      sd("HumanName", "complex-type", {
        HumanName: {},
        "HumanName.family": { type: [{ code: "string" }], short: "Family name" },
      }),
      sd("Patient", "resource", {
        Patient: { short: "Information about a patient" },
        "Patient.active": { type: [{ code: "boolean" }], isModifier: true },
        "Patient.name": { max: "*", type: [{ code: "HumanName" }] },
        "Patient.gender": {
          type: [{ code: "code" }],
          binding: {
            strength: "required",
            valueSet: "http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1",
            description: "dropped",
          },
        },
        "Patient.generalPractitioner": {
          max: "*",
          type: [
            { code: "Reference", targetProfile: [`${FHIR}Organization`, `${FHIR}Practitioner`] },
          ],
        },
      }),
      sd(
        "SimpleQuantity",
        "complex-type",
        {
          Quantity: { definition: "dropped", mustSupport: false },
          "Quantity.comparator": { max: "0" },
          "Quantity.system": { fixedUri: "http://unitsofmeasure.org", mustSupport: true },
        },
        { type: "Quantity", derivation: "constraint", baseDefinition: `${FHIR}Quantity` },
      ),
      sd(
        "vitalsigns",
        "resource",
        {
          Observation: {},
          "Observation.category": {
            max: "*",
            slicing: {
              discriminator: [{ type: "value", path: "coding" }],
              rules: "open",
              ordered: false,
            },
          },
          "Observation.category:VSCat": {
            path: "Observation.category",
            sliceName: "VSCat",
            min: 1,
            patternCodeableConcept: { coding: [{ code: "vital-signs" }] },
          },
        },
        { type: "Observation", derivation: "constraint" },
      ),
      // Left out without an issue: an extension definition, a logical model, other resources.
      sd(
        "patient-birthPlace",
        "complex-type",
        { Extension: {} },
        { type: "Extension", derivation: "constraint" },
      ),
      sd("Definition", "logical", { Definition: {} }),
      { resourceType: "ValueSet", url: "http://hl7.org/fhir/ValueSet/administrative-gender" },
      ...extra,
    ],
  };
}
