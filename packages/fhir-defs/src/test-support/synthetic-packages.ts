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

const types = (...codes: string[]) => ({ type: codes.map((code) => ({ code })) });

/**
 * A small R4 core package for path resolution: resources with backbone elements, a choice, a
 * contentReference (both forms), References with and without targets, datatypes, and profiles
 * with a slice, a type slice and a prohibited element.
 */
export function r4Paths(): PackageContents {
  return {
    id: "hl7.fhir.r4.core",
    version: "4.0.1",
    fhirVersions: ["4.0.1"],
    resources: [
      sd("Resource", "resource", { Resource: {} }, { abstract: true, derivation: undefined }),
      ...["string", "decimal", "boolean", "code", "uri", "integer"].map((p) =>
        sd(p, "primitive-type", { [p]: {} }),
      ),
      sd("Element", "complex-type", { Element: {} }, { derivation: undefined }),
      sd("Quantity", "complex-type", {
        Quantity: {},
        "Quantity.extension": { max: "*", ...types("Extension") },
        "Quantity.value": types("decimal"),
        "Quantity.comparator": types("code"),
        "Quantity.unit": types("string"),
      }),
      sd("Coding", "complex-type", {
        Coding: {},
        "Coding.system": types("uri"),
        "Coding.code": types("code"),
      }),
      sd("CodeableConcept", "complex-type", {
        CodeableConcept: {},
        "CodeableConcept.coding": { max: "*", ...types("Coding") },
        "CodeableConcept.text": types("string"),
      }),
      sd("Reference", "complex-type", { Reference: {}, "Reference.reference": types("string") }),
      sd("Patient", "resource", {
        Patient: {},
        "Patient.extension": { max: "*", ...types("Extension") },
        "Patient.gender": types("code"),
      }),
      sd("Group", "resource", { Group: {} }),
      sd("Observation", "resource", {
        Observation: {},
        "Observation.code": { min: 1, ...types("CodeableConcept") },
        "Observation.subject": {
          type: [
            {
              code: "Reference",
              targetProfile: [
                `${FHIR}Patient`,
                `${FHIR}Group`,
                `${FHIR}vitalsigns`,
                `${FHIR}SimpleQuantity`,
                "http://example.org/StructureDefinition/not-loaded",
              ],
            },
          ],
        },
        "Observation.focus": { max: "*", type: [{ code: "Reference" }] },
        "Observation.value[x]": {
          short: "Actual result",
          ...types("Quantity", "string", "boolean"),
        },
        "Observation.component": { max: "*", ...types("BackboneElement") },
        "Observation.component.code": types("CodeableConcept"),
        "Observation.component.value[x]": types("Quantity", "integer"),
        "Observation.status": {
          min: 1,
          isModifier: true,
          binding: {
            strength: "required",
            valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
          },
          ...types("code"),
        },
      }),
      sd("Questionnaire", "resource", {
        Questionnaire: {},
        "Questionnaire.item": { max: "*", ...types("BackboneElement") },
        "Questionnaire.item.linkId": types("string"),
        "Questionnaire.item.item": { max: "*", contentReference: "#Questionnaire.item" },
        "Questionnaire.item.answer": {
          max: "*",
          contentReference: `${FHIR}Questionnaire#Questionnaire.item`,
        },
      }),
      sd(
        "SimpleQuantity",
        "complex-type",
        {
          Quantity: {},
          "Quantity.value": types("decimal"),
          "Quantity.comparator": { max: "0", ...types("code") },
        },
        { type: "Quantity", derivation: "constraint" },
      ),
      sd(
        "vitalsigns",
        "resource",
        {
          Observation: {},
          "Observation.category": {
            max: "*",
            slicing: { rules: "open" },
            ...types("CodeableConcept"),
          },
          "Observation.category:VSCat": {
            path: "Observation.category",
            sliceName: "VSCat",
            min: 1,
            max: "1",
            mustSupport: true,
            ...types("CodeableConcept"),
          },
          "Observation.category:VSCat.coding": {
            path: "Observation.category.coding",
            max: "*",
            ...types("Coding"),
          },
          "Observation.category:gone": {
            path: "Observation.category",
            sliceName: "gone",
            max: "0",
          },
          "Observation.value[x]": types("Quantity", "string"),
          "Observation.value[x]:valueQuantity": {
            path: "Observation.value[x]",
            sliceName: "valueQuantity",
            min: 1,
            ...types("Quantity"),
          },
          "Observation.method": { max: "0", ...types("CodeableConcept") },
        },
        { type: "Observation", derivation: "constraint" },
      ),
    ],
  };
}
