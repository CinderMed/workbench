import { validateProjectSchema } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, buildProject, columnNames } from "./new-project-form";

const draft = {
  ...EMPTY_DRAFT,
  name: "Metastra",
  canonicalBase: "https://example.org/fhir/metastra/",
  table: "FirstOverview",
  columns: "patient_id;quest_kps;obs_bloodt_hb",
};

describe("the new project form (A1)", () => {
  it("reads column names from lines or from one header line with its separator", () => {
    expect(columnNames("a\nb\n\nc")).toEqual(["a", "b", "c"]);
    expect(columnNames("a;b;c")).toEqual(["a", "b", "c"]);
    expect(columnNames("a\tb,c")).toEqual(["a", "b,c"]);
    expect(columnNames("a,b")).toEqual(["a", "b"]);
    expect(columnNames(" only ")).toEqual([" only "]);
    expect(columnNames("")).toEqual([]);
  });

  it("builds a schema-valid project with the packages and no trailing slash in the base", () => {
    const built = buildProject({ ...draft, packages: "hl7.fhir.uv.ips#1.1.0\n\n" });
    if (!("project" in built)) throw new Error(JSON.stringify(built.errors));
    expect(validateProjectSchema(built.project)).toEqual([]);
    expect(built.project.project).toMatchObject({
      name: "Metastra",
      canonicalBase: "https://example.org/fhir/metastra",
      packages: [{ name: "hl7.fhir.uv.ips", version: "1.1.0" }],
    });
    expect(built.project.sources[0].columns.map((c) => c.name)).toEqual([
      "patient_id",
      "quest_kps",
      "obs_bloodt_hb",
    ]);
  });

  it("names every missing or wrong field", () => {
    const built = buildProject({
      ...EMPTY_DRAFT,
      canonicalBase: "ftp://x",
      packages: "ips\nhl7.fhir.uv.ips#1.1.0",
    });
    expect("errors" in built && built.errors).toEqual([
      { field: "name", key: "required" },
      { field: "canonicalBase", key: "notUrl" },
      { field: "table", key: "required" },
      { field: "packages", key: "packageFormat", line: 1 },
      { field: "columns", key: "required" },
    ]);
    const duplicate = buildProject({ ...draft, columns: "a,a" });
    expect("errors" in duplicate && duplicate.errors[0]).toMatchObject({
      field: "columns",
      key: "header",
    });
  });
});
