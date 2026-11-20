import { describe, expect, it } from "vitest";
import { TypeCounter, checkHeader, initProject, readDataFile } from "./init.js";

const settings = {
  name: "Visits",
  table: "Visit",
  fileName: "visit.csv",
  fhirVersion: "4.0.1",
  canonicalBase: "https://cindermed.org/fhir/visits",
  read: { delimiter: ",", encoding: "utf-8", headerRow: 1 },
  importedAt: "2026-11-20T12:00:00Z",
} as const;

async function* bytes(text: string, size = 5): AsyncIterable<Uint8Array> {
  const all = new TextEncoder().encode(text);
  for (let i = 0; i < all.length; i += size) {
    await Promise.resolve();
    yield all.slice(i, i + size);
  }
}

describe("checkHeader", () => {
  it("trims names and reports empty and duplicate headers by position", () => {
    expect(checkHeader([" id ", "age"])).toEqual({ names: ["id", "age"], errors: [] });
    expect(checkHeader(["id", "", "age", " id"]).errors.map((e) => e.message)).toEqual([
      "column 2 has an empty header",
      "columns 1 and 4 have the same header 'id'",
    ]);
  });
});

describe("initProject", () => {
  it("writes one table of string columns, with readable unique ids", () => {
    const project = initProject(["patient_id", "Età (anni)", "%", "a", "a b", "a_b"], settings);
    expect(project.instances).toEqual([]);
    expect(project.mappings).toEqual([]);
    expect(project.valueMaps).toEqual([]);
    expect(project.project).toEqual({
      id: "prj_visits",
      name: "Visits",
      fhirVersion: "4.0.1",
      canonicalBase: "https://cindermed.org/fhir/visits",
    });
    const [source] = project.sources;
    expect(source.id).toBe("src_visit");
    expect(source.columns.map((c) => [c.id, c.name, c.dataType])).toEqual([
      ["col_patient_id", "patient_id", "string"],
      ["col_Eta_anni", "Età (anni)", "string"],
      ["col_003", "%", "string"],
      ["col_a_004", "a", "string"],
      ["col_a_b", "a b", "string"],
      ["col_a_b_2", "a_b", "string"],
    ]);
    expect(source.import).toEqual({
      fileName: "visit.csv",
      fileKind: "data",
      delimiter: ",",
      encoding: "utf-8",
      headerRow: 1,
      importedAt: "2026-11-20T12:00:00Z",
    });
  });
});

describe("TypeCounter", () => {
  it("suggests the most specific type every non-empty cell converts to, and counts the rest", () => {
    const counter = new TypeCounter(["n", "d", "when", "flag", "mixed", "blank"]);
    for (const row of [
      ["1", "11,20", "12/03/2024", "yes", "4", ""],
      ["+7", "3", "01/01/2025", "N", "x", " "],
      ["", "-0,5", "31/12/2023", "0", "5", ""],
    ])
      counter.add(row);
    counter.add(["2"]);
    const report = counter.report("f.csv");
    expect(report.rowsRead).toBe(4);
    expect(report.rowsWithOtherCellCount).toBe(1);
    expect(report.columns.map((c) => [c.name, c.suggested, c.emptyCells])).toEqual([
      ["n", { dataType: "integer" }, 1],
      ["d", { dataType: "decimal", decimalSeparator: "," }, 1],
      ["when", { dataType: "date", dateFormat: "dd/MM/yyyy" }, 1],
      ["flag", { dataType: "boolean" }, 1],
      ["mixed", { dataType: "string" }, 1],
      ["blank", { dataType: "string" }, 4],
    ]);
    const mixed = report.columns[4]?.candidates.find((c) => c.dataType === "integer");
    expect(mixed?.cellsNotConverting).toBe(1);
  });
});

describe("readDataFile", () => {
  it("reads only up to the header without --infer", async () => {
    let pulled = 0;
    async function* endless(): AsyncIterable<Uint8Array> {
      const encoder = new TextEncoder();
      yield encoder.encode("a,b\n");
      for (;;) {
        pulled += 1;
        if (pulled > 1) throw new Error("read past the header");
        await Promise.resolve();
        yield encoder.encode("1,2\n");
      }
    }
    const result = await readDataFile(endless(), settings.read, { infer: false, fileName: "x" });
    expect(result).toEqual({ ok: true, names: ["a", "b"] });
    expect(pulled).toBe(0);
  });

  it("skips empty records before the header row, as the normalizer does", async () => {
    const text = "Visit export\n\n;;\nid;age\n1;2\n";
    const result = await readDataFile(
      bytes(text),
      { delimiter: ";", encoding: "utf-8", headerRow: 2 },
      { infer: true, fileName: "x" },
    );
    expect(result.ok && result.names).toEqual(["id", "age"]);
    expect(result.ok && result.report?.rowsRead).toBe(1);
  });

  it("explains a missing header and an empty file", async () => {
    const short = await readDataFile(
      bytes("a,b\n"),
      { ...settings.read, headerRow: 3 },
      { infer: false, fileName: "x" },
    );
    expect(short).toEqual({
      ok: false,
      errors: [{ message: "the file has 1 non-empty records, so there is no header at row 3" }],
    });
    expect(
      await readDataFile(bytes("\n\n"), settings.read, { infer: false, fileName: "x" }),
    ).toEqual({ ok: false, errors: [{ message: "the file has no records" }] });
  });
});
