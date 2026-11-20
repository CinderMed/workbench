import { describe, expect, it } from "vitest";
import { patientProject, syntheticDefinitions } from "./synthetic-definitions";
import { openDefinitions, validateAll } from "./validate";

describe("validateAll", () => {
  it("runs the FHIR checks as cindermed validate: the boolean on Patient.name is an error", async () => {
    const definitions = syntheticDefinitions();
    const validation = await validateAll(patientProject(), definitions);
    expect(validation.fhir).toEqual({ kind: "checked", fhirVersion: "4.0.1" });
    const errors = validation.results.filter((r) => r.severity === "error");
    expect(errors.map((r) => [r.code, r.objectKind, r.id, r.field])).toEqual([
      ["COMPLEX_TARGET", "mapping", "map_name01", "path"],
    ]);
  });

  it("says why the FHIR checks did not run", async () => {
    expect((await validateAll(patientProject(), { message: "404" })).fhir).toEqual({
      kind: "unavailable",
      message: "404",
    });
    const r5 = patientProject();
    r5.project.fhirVersion = "5.0.0";
    expect((await validateAll(r5, syntheticDefinitions())).fhir).toEqual({
      kind: "otherVersion",
      indexVersion: "4.0.1",
    });
    const broken = { ...patientProject(), formatVersion: "x" };
    const notRun = await validateAll(broken, syntheticDefinitions());
    expect(notRun.fhir).toEqual({ kind: "notRun" });
    expect(notRun.results[0]?.code).toBe("SCHEMA_VIOLATION");
  });

  it("opens the index, or explains why not", async () => {
    const { fetch } = syntheticDefinitions();
    expect("defs" in (await openDefinitions(fetch))).toBe(true);
    expect(await openDefinitions(() => Promise.reject(new Error("index.json: 404")))).toEqual({
      message: "index.json: 404",
    });
    expect(await openDefinitions(() => Promise.resolve("{"))).toEqual({
      message: "index.json is not JSON",
    });
  });
});
