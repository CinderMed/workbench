import type { Instance, ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./build-index.js";
import { FhirDefinitions } from "./definitions.js";
import { SliceNameCode, checkSliceNames, usableSliceName } from "./slice-names.js";
import { FHIR, r4Paths, sd } from "./test-support/synthetic-packages.js";

const category = (sliceName: string, min: number) => ({
  [`Observation.category:${sliceName}`]: {
    path: "Observation.category",
    sliceName,
    min,
    type: [{ code: "CodeableConcept" }],
  },
});

const defs = (() => {
  const paths = r4Paths();
  const index = buildIndex("4.0.1", [
    {
      ...paths,
      resources: [
        ...paths.resources,
        sd(
          "odd-slices",
          "resource",
          {
            Observation: {},
            "Observation.category": {
              max: "*",
              slicing: { rules: "open" },
              type: [{ code: "CodeableConcept" }],
            },
            ...category("VS_Cat", 1),
            ...category("other_cat", 0),
            ...category("Fine-1", 1),
          },
          { type: "Observation", derivation: "constraint" },
        ),
      ],
    },
  ]);
  if (!index.ok) throw new Error(JSON.stringify(index.issues));
  const opened = FhirDefinitions.open(index.value.manifest);
  if (!opened.ok) throw new Error("not opened");
  for (const [file, text] of index.value.files) opened.value.add(file, text);
  return opened.value;
})();

const role = (id: string, profile?: string): Instance => ({
  id,
  resourceType: "Observation",
  index: 0,
  sourceId: "src",
  multiplicity: { kind: "perRow" },
  ...(profile === undefined ? {} : { profile }),
});
const check = (instances: Instance[]) => {
  const project: ProjectFile = {
    formatVersion: "1.4.0",
    project: { id: "p", name: "p", fhirVersion: "4.0.1", canonicalBase: "http://example.org" },
    sources: [{ id: "src", name: "T", columns: [{ id: "c", name: "c", dataType: "string" }] }],
    instances,
    mappings: [],
    valueMaps: [],
  };
  return checkSliceNames(project, defs, (i) => i.profile ?? i.resourceType).map((r) => [
    r.severity,
    r.code,
    r.id,
    r.field,
    r.message,
  ]);
};

describe("usableSliceName", () => {
  it("accepts the names a project path can hold", () => {
    for (const name of ["nrs", "VSCat", "SystolicBP", "Fine-1"])
      expect(usableSliceName(name)).toBe(true);
    for (const name of ["VS_Cat", "1st", "a/b", "a@b", "a[b]", "-a", ""])
      expect(usableSliceName(name)).toBe(false);
  });
});

describe("SLICE_NAME_UNUSABLE", () => {
  it("warns about a required profile slice whose name a project cannot write", () => {
    expect(check([role("obs", `${FHIR}odd-slices`)])).toEqual([
      [
        "warning",
        SliceNameCode.SLICE_NAME_UNUSABLE,
        "obs",
        "profile",
        "Observation[0]: the profile requires slice category[VS_Cat] (min 1), but its name cannot be written in a project path (letters, digits and '-', starting with a letter): the resource may not conform to the profile",
      ],
    ]);
  });

  it("accepts VSCat, and leaves roles without a profile alone", () => {
    expect(check([role("obs", `${FHIR}vitalsigns`)])).toEqual([]);
    expect(check([role("obs")])).toEqual([]);
  });
});
