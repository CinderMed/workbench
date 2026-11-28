import { describe, expect, it } from "vitest";
import { validateProjectSchema } from "../schema-validation.js";
import { checkHeader, newProject } from "./new-project.js";

describe("newProject (A1, ADR-0022)", () => {
  it("makes a schema-valid project with one string table, its description and packages", () => {
    const project = newProject(["patient id", "età", "patient id 2"], {
      name: "Pain Study",
      description: "  Pain scores of the 2025 cohort ",
      fhirVersion: "4.0.1",
      canonicalBase: "https://example.org/fhir/pain",
      packages: [{ name: "hl7.fhir.uv.ips", version: "1.1.0" }],
      table: "Visits",
    });
    expect(validateProjectSchema(project)).toEqual([]);
    expect(project.project).toEqual({
      id: "prj_pain_study",
      name: "Pain Study",
      description: "Pain scores of the 2025 cohort",
      fhirVersion: "4.0.1",
      packages: [{ name: "hl7.fhir.uv.ips", version: "1.1.0" }],
      canonicalBase: "https://example.org/fhir/pain",
    });
    expect(project.sources[0].columns.map((c) => [c.id, c.name, c.dataType])).toEqual([
      ["col_patient_id", "patient id", "string"],
      ["col_eta", "età", "string"],
      ["col_patient_id_2", "patient id 2", "string"],
    ]);
    expect(project.sources[0]).not.toHaveProperty("import");
  });

  it("leaves out an empty description and packages", () => {
    const project = newProject(["a"], {
      name: "X",
      description: " ",
      fhirVersion: "5.0.0",
      canonicalBase: "https://example.org/fhir/x",
      packages: [],
      table: "t",
    });
    expect(project.project).not.toHaveProperty("description");
    expect(project.project).not.toHaveProperty("packages");
    expect(project.project.id).toBe("prj_x_project");
  });

  it("codes the header errors", () => {
    expect(checkHeader(["a", "", "a", "b�"]).errors.map((e) => e.code)).toEqual([
      "encoding",
      "empty",
      "duplicate",
    ]);
  });
});
