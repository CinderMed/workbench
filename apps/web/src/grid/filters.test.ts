import { type ProjectFile, isProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { NONE, NO_FILTER, bulkRows, filterRows, isFiltered } from "./filters";
import { gridRows } from "./rows";

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

const metastra = () => load(metastraProject);
const codes = (rows: ReturnType<typeof gridRows>) => rows.map((r) => r.mapping?.code ?? "—");

describe("filters and bulk actions (D8)", () => {
  it("filters the lines by status, role and section, together", () => {
    const project = metastra();
    const rows = gridRows(project, project.sources[0]);
    expect(filterRows(rows, NO_FILTER)).toEqual(rows);
    expect(isFiltered(NO_FILTER)).toBe(false);

    const patient = filterRows(rows, { ...NO_FILTER, roleId: "ins_patient0" });
    expect(codes(patient)).toEqual(["R-001", "R-002", "R-003"]);
    // Lines of columns without rows have no role and no status.
    const noRole = filterRows(rows, { ...NO_FILTER, roleId: NONE });
    expect(noRole.length).toBeGreaterThan(0);
    expect(noRole.every((r) => r.mapping === undefined)).toBe(true);
    // No status: those lines, and saved rows without a review (Metastra's references).
    const noStatus = filterRows(rows, { ...NO_FILTER, status: NONE });
    expect(noStatus).toEqual(expect.arrayContaining(noRole));
    expect(noStatus.every((r) => r.mapping?.review === undefined)).toBe(true);
    expect(noStatus.length).toBeGreaterThan(noRole.length);

    const statuses = new Set(rows.flatMap((r) => r.mapping?.review?.status ?? []));
    for (const status of statuses) {
      const kept = filterRows(rows, { ...NO_FILTER, status });
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.every((r) => r.mapping?.review?.status === status)).toBe(true);
    }

    const section = rows.find((r) => r.column?.sectionId !== undefined)?.column?.sectionId;
    const both = filterRows(rows, {
      status: undefined,
      roleId: "ins_patient0",
      sectionId: section,
    });
    expect(
      both.every(
        (r) => r.column?.sectionId === section && r.mapping?.instanceId === "ins_patient0",
      ),
    ).toBe(true);
    expect(isFiltered({ ...NO_FILTER, sectionId: section })).toBe(true);
  });

  it("changes only the rows that differ, and keeps a review's comments", () => {
    const project = metastra();
    const [first, second] = project.mappings;
    if (first === undefined || second === undefined) throw new Error("rows");
    const commented = { ...first, review: { status: "draft" as const, comments: [] } };
    const changed = bulkRows([commented, { ...second, review: { status: "approved" } }], {
      kind: "status",
      status: "approved",
    });
    expect(changed).toEqual([{ ...commented, review: { status: "approved", comments: [] } }]);
    const unreviewed = { ...second };
    delete unreviewed.review;
    expect(bulkRows([unreviewed], { kind: "status", status: "todo" })).toEqual([
      { ...unreviewed, review: { status: "todo" } },
    ]);
    expect(bulkRows([first, second], { kind: "role", roleId: first.instanceId })).toEqual(
      first.instanceId === second.instanceId ? [] : [{ ...second, instanceId: first.instanceId }],
    );
  });
});
