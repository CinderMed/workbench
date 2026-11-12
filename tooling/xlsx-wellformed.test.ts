// Every XML part of the mapping-table workbook (H1) is well-formed: parsed by Python's XML parser,
// which rejects anything a spreadsheet program would reject as XML. Runs on the built package
// (CI builds packages before the tests); the workbook is written only to .tmp/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type * as ExportModule from "../packages/export/src/index.js";
import { parseProject } from "../packages/model/src/index.js";

const root = resolve(import.meta.dirname, "..");
const work = join(root, ".tmp", "xlsx-wellformed");

const check = `
import sys, zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
    names = sorted(z.namelist())
    for name in names:
        ET.fromstring(z.read(name))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet2.xml"))
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    print(len(names), len(sheet.findall(".//m:row", ns)))
`;

describe("mapping-table workbook", () => {
  mkdirSync(work, { recursive: true });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it.each(["metastra", "mimic-iv-demo"])("is well-formed XML for %s", async (name) => {
    const { mappingTables, toXlsx } = (await import(
      join(root, "packages/export/dist/index.js")
    )) as typeof ExportModule;
    const project = parseProject(
      readFileSync(join(root, `fixtures/fml-examples/${name}/project.json`), "utf8"),
    ).project;
    if (project === undefined) throw new Error("fixture project is not valid");
    const sheets = mappingTables(project);
    const file = join(work, `${name}.xlsx`);
    writeFileSync(file, toXlsx(sheets, { createdAt: "2026-11-12T00:00:00Z" }));
    const [parts, rows] = execFileSync("python3", ["-I", "-c", check, file], { encoding: "utf8" })
      .trim()
      .split(" ")
      .map(Number);
    expect(parts).toBe(10);
    const valueMaps = sheets.find((s) => s.name === "Value maps");
    expect(rows).toBe((valueMaps?.rows.length ?? 0) + 1);
  });
});
