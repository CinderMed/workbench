import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { painProject } from "../validation/synthetic-definitions";
import {
  type SliceDraft,
  buildSlice,
  describeDiscriminator,
  discriminatorChoices,
  repeats,
  rowsUsingSlice,
  slicePath,
  slicesOn,
  valueKind,
  withSlice,
  withoutSlice,
} from "./slices";

const node = (name: string, type: string, max = "1"): TreeNode => ({
  name,
  path: `component.${name}`,
  elementId: `Observation.component.${name}`,
  min: 0,
  max,
  types: [{ code: type }],
  expandable: false,
});

const draft = (fields: Partial<SliceDraft>): SliceDraft => ({
  name: "nrs",
  discriminatorPath: "code",
  system: "http://snomed.info/sct",
  code: "1284852002",
  display: "",
  value: "",
  ...fields,
});

const CODING = { kind: "coding", type: "CodeableConcept" } as const;

const role = (): Instance => {
  const found = painProject().instances[0];
  if (found === undefined) throw new Error("a role");
  return found;
};

describe("named slices (D4)", () => {
  it("builds the Metastra slice: a manual SNOMED CT code on component.code", () => {
    const built = buildSlice("slc_new", "component", CODING, draft({}), []);
    if (!("slice" in built)) throw new Error(built.error);
    const expected = metastraProject.instances.flatMap((i) => i.slices ?? [])[0];
    // The same slice as the fixture's, except its id.
    expect({ ...built.slice, id: expected?.id }).toEqual(expected);
    expect(built.slice.id).toBe("slc_new");
  });

  it("refuses a missing, invalid or repeated name, and an incomplete value", () => {
    const error = (fields: Partial<SliceDraft>, taken: string[] = []) => {
      const built = buildSlice("slc_new", "component", CODING, draft(fields), taken);
      return "error" in built ? built.error : undefined;
    };
    expect(error({ name: " " })).toBe("nameRequired");
    expect(error({ name: "1st" })).toBe("nameInvalid");
    expect(error({ name: "pain score" })).toBe("nameInvalid");
    expect(error({}, ["nrs"])).toBe("nameTaken");
    expect(error({ system: "" })).toBe("systemRequired");
    expect(error({ code: " " })).toBe("codeRequired");
    expect(buildSlice("slc_new", "component", undefined, draft({}), [])).toEqual({
      error: "discriminatorRequired",
    });
  });

  it("keeps a display, and types primitive values strictly", () => {
    const withDisplay = buildSlice("s", "component", CODING, draft({ display: "NRS" }), []);
    expect("slice" in withDisplay && withDisplay.slice.discriminator[0].value).toEqual({
      type: "CodeableConcept",
      coding: {
        system: "http://snomed.info/sct",
        code: "1284852002",
        display: "NRS",
        verification: { status: "manual" },
      },
    });
    const value = (type: "integer" | "boolean" | "date" | "code", text: string) => {
      const built = buildSlice("s", "x", { kind: "primitive", type }, draft({ value: text }), []);
      return "slice" in built ? built.slice.discriminator[0].value : built.error;
    };
    expect(value("integer", "3")).toEqual({ type: "integer", value: 3 });
    expect(value("integer", "3.5")).toBe("valueInvalid");
    expect(value("boolean", "false")).toEqual({ type: "boolean", value: false });
    expect(value("boolean", "no")).toBe("valueInvalid");
    expect(value("date", "2024-02-30")).toEqual({ type: "date", value: "2024-02-30" });
    expect(value("date", "30/01/2024")).toBe("valueInvalid");
    expect(value("code", "")).toBe("valueRequired");
  });

  it("offers the children with a code or simple value as discriminators, code first", () => {
    const choices = discriminatorChoices([
      node("value", "Quantity"),
      node("system", "uri"),
      node("code", "CodeableConcept"),
      { ...node("name", "HumanName") },
    ]);
    expect(choices.map((c) => c.name)).toEqual(["code", "system"]);
    expect(valueKind(node("code", "Coding"))).toEqual({ kind: "coding", type: "Coding" });
    expect(
      valueKind({ ...node("v", "integer"), types: [{ code: "integer" }, { code: "string" }] }),
    ).toBeUndefined();
    expect(repeats({ max: "*" })).toBe(true);
    expect(repeats({ max: "2" })).toBe(true);
    expect(repeats({ max: "1" })).toBe(false);
  });

  it("adds and removes a role's slices, and counts the rows that write to one", () => {
    const built = buildSlice("slc_nrs", "component", CODING, draft({}), []);
    if (!("slice" in built)) throw new Error(built.error);
    const slice = built.slice;
    const sliced = withSlice(role(), slice);
    expect(slicesOn(sliced, "component").map(slicePath)).toEqual(["component[nrs]"]);
    expect(slicesOn(sliced, "category")).toEqual([]);
    expect(withoutSlice(sliced, "slc_nrs")).toEqual(role()); // No empty `slices` left.
    expect(describeDiscriminator(slice)).toBe("code = http://snomed.info/sct|1284852002");

    const project = painProject();
    const [row] = project.mappings;
    if (row === undefined) throw new Error("a row");
    const rows = [
      { ...row, path: "component[nrs].valueInteger" },
      { ...row, id: "map_2", path: "component[nrs]" },
      { ...row, id: "map_3", path: "component[nrsx].valueInteger" },
      { ...row, id: "map_4", path: "component.valueInteger" },
      { ...row, id: "map_5", instanceId: "ins_other", path: "component[nrs].valueInteger" },
    ];
    expect(rowsUsingSlice({ ...project, mappings: rows }, "ins_obs001", slice)).toBe(2);
  });
});
