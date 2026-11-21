import type { MappingRow, ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import {
  painProject,
  patientProject,
  syntheticDefinitions,
} from "../validation/synthetic-definitions";
import { fitter } from "./fit";
import { loadLevels } from "./tree";

const first = (project: ProjectFile): MappingRow => {
  const row = project.mappings[0];
  if (row === undefined) throw new Error("a row");
  return row;
};

/** The fit of paths for a row, with the role's documents loaded as the picker loads them. */
async function fits(project: ProjectFile, row: MappingRow, type: string, open: string[] = []) {
  const { defs, fetch } = syntheticDefinitions();
  let levels = new Map();
  for (const path of ["", ...open]) {
    const loaded = await loadLevels(defs, fetch, type, path, levels, path === "" ? 4 : 0);
    if ("message" in loaded) throw new Error(loaded.message);
    levels = new Map(loaded.levels);
  }
  return fitter(defs, type, type, project, row);
}

describe("how elements fit the row in the picker (type compatibility, point 1)", () => {
  it("greys what no transform of a boolean column can write, and names the transforms of the rest", async () => {
    const project = patientProject();
    const fit = await fits(project, first(project), "Patient", ["name"]);
    expect(fit("active")).toEqual({ kind: "ok" });
    // A HumanName takes no boolean, whatever the transform.
    expect(fit("name")).toMatchObject({ kind: "blocked" });
    expect(fit("name").kind === "blocked" && fit("name")).toMatchObject({
      message: expect.stringContaining("complex type") as unknown,
    });
    // A string takes it once converted (a value map gives codes, codings or booleans).
    expect(fit("name.family")).toEqual({ kind: "needs", transforms: ["cast"] });
  });

  it("names the transform a code or string element needs from an integer copy", async () => {
    const project = painProject();
    const fit = await fits(project, first(project), "Observation");
    expect(fit("component.valueInteger")).toEqual({ kind: "ok" });
    // A conversion to string on a choice is written with the chosen type (#156, ADR-0023).
    expect(fit("component.valueString")).toEqual({ kind: "needs", transforms: ["cast"] });
    expect(fit("component.code")).toEqual({ kind: "needs", transforms: ["coding"] });
    expect(fit("component")).toMatchObject({ kind: "blocked" });
  });

  it("checks a chosen transform as it is", async () => {
    const project = painProject();
    const row: MappingRow = {
      ...first(project),
      transform: { kind: "coding", system: "http://loinc.org", as: "CodeableConcept" },
    };
    const fit = await fits(project, row, "Observation");
    expect(fit("component.code")).toEqual({ kind: "ok" });
    // No other transform is offered: the row's coding cannot write an integer element.
    expect(fit("component.valueInteger")).toMatchObject({ kind: "blocked" });
  });
});
