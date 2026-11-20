import type { ValidationResult } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { patientProject } from "../validation/synthetic-definitions";
import { cellFindings } from "./findings";
import { gridRows } from "./rows";

const result = (
  r: Partial<ValidationResult> & Pick<ValidationResult, "objectKind">,
): ValidationResult => ({
  severity: "error",
  code: "X",
  message: "m",
  ...r,
});

describe("cellFindings", () => {
  const project = patientProject();
  const rows = gridRows(project, project.sources[0]);

  it("puts a row's result on the cell of its field", () => {
    const cells = cellFindings(rows, [
      result({ objectKind: "mapping", id: "map_name01", field: "path", message: "not HumanName" }),
      result({ objectKind: "mapping", id: "map_name01", field: "instanceId", severity: "warning" }),
      result({ objectKind: "mapping", id: "map_active", field: "transform.kind" }),
      result({ objectKind: "mapping", id: "map_active" }),
    ]);
    expect(cells.get("map_name01/element")?.items.map((r) => r.message)).toEqual(["not HumanName"]);
    expect(cells.get("map_name01/role")?.severity).toBe("warning");
    expect(cells.get("map_active/transform")?.severity).toBe("error");
    expect(cells.get("map_active/code")?.severity).toBe("error");
  });

  it("puts a column's result on its rows, and a role's on their Role cells", () => {
    const cells = cellFindings(rows, [
      result({ objectKind: "column", id: "col_flag01", severity: "warning", message: "no values" }),
      result({ objectKind: "instance", id: "ins_pat001", message: "unknown type" }),
    ]);
    expect(cells.get("map_active/column")?.items.map((r) => r.message)).toEqual(["no values"]);
    expect(cells.get("map_name01/column")?.items.map((r) => r.message)).toEqual(["no values"]);
    expect(cells.get("map_active/role")?.items.map((r) => r.message)).toEqual(["unknown type"]);
  });

  it("keeps the worst severity and every message of a cell, and ignores results elsewhere", () => {
    const cells = cellFindings(rows, [
      result({
        objectKind: "mapping",
        id: "map_name01",
        field: "path",
        severity: "warning",
        message: "a",
      }),
      result({ objectKind: "mapping", id: "map_name01", field: "path", message: "b" }),
      result({ objectKind: "mapping", id: "map_other1", field: "path" }),
      result({ objectKind: "project" }),
    ]);
    const cell = cells.get("map_name01/element");
    expect(cell?.severity).toBe("error");
    expect(cell?.items.map((r) => r.message)).toEqual(["b", "a"]); // Errors first.
    expect(cells.size).toBe(1);
  });
});
