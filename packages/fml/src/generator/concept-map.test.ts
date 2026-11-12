import { isProjectFile, type ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import visitProject from "../../../../fixtures/fml-examples/boolean-value-map/project.json" with { type: "json" };
import administrativeGender from "../../../../fixtures/fml-examples/metastra/ConceptMap-administrativeGender.json?raw";
import hbUnit from "../../../../fixtures/fml-examples/metastra/ConceptMap-hbUnit.json?raw";
import osteoStatus from "../../../../fixtures/fml-examples/metastra/ConceptMap-osteoStatus.json?raw";
import painLevel from "../../../../fixtures/fml-examples/metastra/ConceptMap-painLevel.json?raw";
import spineLevel from "../../../../fixtures/fml-examples/metastra/ConceptMap-spineLevel.json?raw";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import sex from "../../../../fixtures/fml-examples/motu/ConceptMap-sex.json?raw";
import motuProject from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import { conceptMap, conceptMaps } from "./concept-map.js";

function project(document: unknown): ProjectFile {
  const file = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(file)) throw new Error("fixture is not a valid project");
  return file;
}

const serialize = (value: unknown): string => JSON.stringify(value, null, 2);

describe("conceptMaps (R4)", () => {
  it("reproduces the verified ConceptMaps byte for byte, in project order", () => {
    expect(conceptMaps(project(metastraProject), { fhirRelease: "R4" }).map(serialize)).toEqual([
      administrativeGender,
      painLevel,
      osteoStatus,
      hbUnit,
      spineLevel,
    ]);
    expect(conceptMaps(project(motuProject), { fhirRelease: "R4" }).map(serialize)).toEqual([sex]);
  });

  it("writes no ConceptMap for a value map with a boolean target", () => {
    const file = project(visitProject);
    expect(file.valueMaps.map((m) => m.target)).toEqual(["boolean"]);
    expect(conceptMaps(file, { fhirRelease: "R4" })).toEqual([]);
  });

  it("omits an empty description and writes targetVersion for a versioned code system", () => {
    const file = project(motuProject);
    const map = file.valueMaps[0];
    if (map === undefined) throw new Error("fixture changed");
    map.description = "";
    map.target = "Coding";
    map.entries = [
      {
        sourceValue: "M",
        sourceLabel: "",
        target: { system: "http://s", version: "2", code: "m", display: "" },
        action: { kind: "use" },
      },
    ];
    expect(conceptMap(file, map, { fhirRelease: "R4" })).toEqual({
      resourceType: "ConceptMap",
      id: "sex",
      url: "http://example.org/fhir/motu/ConceptMap/sex",
      version: "1.3.0",
      name: "Sex",
      status: "draft",
      group: [
        {
          element: [{ code: "M", target: [{ code: "m", equivalence: "equivalent" }] }],
          target: "http://s",
          targetVersion: "2",
        },
      ],
    });
  });
});

describe("conceptMaps (R5)", () => {
  it("uses relationship instead of equivalence and puts the version in group.target", () => {
    const file = project(metastraProject);
    const pain = conceptMaps(file, { fhirRelease: "R5" })[1];
    expect(pain?.group.map((g) => g.target)).toEqual([
      "http://loinc.org",
      "http://snomed.info/sct",
    ]);
    const targets = pain?.group.flatMap((g) => g.element.flatMap((e) => e.target)) ?? [];
    expect(targets).toHaveLength(4);
    for (const target of targets) {
      expect(target).toHaveProperty("relationship", "equivalent");
      expect(target).not.toHaveProperty("equivalence");
    }
    const map = file.valueMaps[1];
    if (map === undefined) throw new Error("fixture changed");
    map.entries = [
      {
        sourceValue: "0",
        target: { system: "http://s", version: "2", code: "x" },
        action: { kind: "use" },
      },
    ];
    expect(conceptMap(file, map, { fhirRelease: "R5" })?.group).toEqual([
      {
        element: [{ code: "0", target: [{ code: "x", relationship: "equivalent" }] }],
        target: "http://s|2",
      },
    ]);
  });
});
