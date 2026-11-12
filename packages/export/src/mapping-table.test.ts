import { parseProject, type ProjectFile } from "@cindermed/model";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import visitProject from "../../../fixtures/fml-examples/boolean-value-map/project.json?raw";
import metastraProject from "../../../fixtures/fml-examples/metastra/project.json?raw";
import mimicProject from "../../../fixtures/fml-examples/mimic-iv-demo/project.json?raw";
import motuProject from "../../../fixtures/fml-examples/motu/project.json?raw";
import {
  columnName,
  looksLikeFormula,
  mappingTables,
  toCsv,
  toXlsx,
  xlsxParts,
  xmlText,
  type Sheet,
} from "./index.js";

function project(text: string): ProjectFile {
  const parsed = parseProject(text).project;
  if (parsed === undefined) throw new Error("fixture project is not valid");
  return parsed;
}

const sheet = (sheets: Sheet[], name: string): Sheet => {
  const found = sheets.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no sheet ${name}`);
  return found;
};

describe.each([
  ["metastra", metastraProject],
  ["motu", motuProject],
  ["boolean-value-map", visitProject],
  ["mimic-iv-demo", mimicProject],
])("mapping table of %s", (_name, text) => {
  const file = project(text);
  const sheets = mappingTables(file);

  it("matches the snapshot of every sheet (CSV)", () => {
    // Readable form: LF line ends and no byte order mark (both are tested exactly under "CSV").
    for (const s of sheets)
      expect(toCsv(s).slice(1).replace(/\r\n/g, "\n")).toMatchSnapshot(s.name);
  });

  it("has one Mapping line per row and one Value maps line per entry of every value map", () => {
    expect(sheet(sheets, "Mapping").rows.map((r) => r[0])).toEqual(
      file.mappings.map((r) => r.code),
    );
    const entries = file.valueMaps.flatMap((m) => m.entries.map((e) => [m.name, e.sourceValue]));
    expect(sheet(sheets, "Value maps").rows.map((r) => [r[0], r[2]])).toEqual(entries);
    expect(sheet(sheets, "Roles").rows).toHaveLength(file.instances.length);
    expect(sheet(sheets, "Columns").rows).toHaveLength(
      file.sources.flatMap((s) => s.columns).length,
    );
  });
});

describe("mapping table content", () => {
  it("documents boolean value maps, which have no ConceptMap", () => {
    expect(sheet(mappingTables(project(visitProject)), "Value maps").rows).toEqual([
      ["siNo", "boolean", "Sì", "", "", "true", "", "", "use", "", "R-002"],
      ["siNo", "boolean", "No", "", "", "false", "", "", "use", "", "R-002"],
    ]);
  });

  it("writes every action with its detail and the verification of codes", () => {
    const file = project(motuProject);
    const map = file.valueMaps[0];
    if (map === undefined) throw new Error("fixture changed");
    map.entries = [
      {
        sourceValue: "M",
        target: { value: "male" },
        action: {
          kind: "use",
          also: [{ path: "active", value: { type: "boolean", value: true } }],
        },
      },
      {
        sourceValue: "U",
        action: {
          kind: "setElement",
          set: [{ path: "gender", value: { type: "code", value: "unknown" } }],
        },
      },
      { sourceValue: "X", action: { kind: "skipInstance" } },
      { sourceValue: "N", action: { kind: "absent" } },
    ];
    const rows = sheet(mappingTables(file), "Value maps").rows;
    expect(rows.map((r) => [r[2], r[8], r[9]])).toEqual([
      ["M", "use", "also: active = true"],
      ["U", "setElement", "set: gender = unknown"],
      ["X", "skipInstance", ""],
      ["N", "absent", ""],
    ]);
    const metastra = sheet(mappingTables(project(metastraProject)), "Value maps").rows;
    expect(new Set(metastra.map((r) => r[7]))).toEqual(new Set(["", "manual", "verified"]));
  });

  it("shows review statuses but never reviewers, comments or provenance", () => {
    const file = project(motuProject);
    const row = file.mappings[0];
    if (row === undefined) throw new Error("fixture changed");
    row.review = {
      status: "toReview",
      comments: [
        {
          id: "cmt_0001",
          author: "reviewer-42",
          createdAt: "2026-11-12T00:00:00Z",
          text: "secret note",
        },
      ],
    };
    row.provenance = { kind: "ai", acceptedBy: "user-7" };
    row.notes = "Check the source.";
    const cells = mappingTables(file).flatMap((s) => s.rows.flat());
    expect(sheet(mappingTables(file), "Mapping").rows[0]?.slice(-2)).toEqual([
      "Check the source.",
      "toReview",
    ]);
    for (const hidden of ["reviewer-42", "secret note", "user-7"]) {
      expect(cells.some((c) => c.includes(hidden))).toBe(false);
    }
  });
});

describe("mapping table of a broken project", () => {
  /** MOTU with dangling references of every kind and a duplicate row code. */
  function broken(): ProjectFile {
    const file = project(motuProject);
    const [r1, r2, r3, r4] = file.mappings;
    const fall = file.instances.find((i) => i.id === "ins_ae0");
    if (
      r1 === undefined ||
      r2 === undefined ||
      r3 === undefined ||
      r4 === undefined ||
      fall === undefined
    ) {
      throw new Error("fixture changed");
    }
    r1.columnId = "col_ghost";
    r1.condition = { op: "notEmpty", columnId: "col_lost" };
    r2.transform = { kind: "valueMap", valueMapId: "vm_ghost" };
    r3.instanceId = "ins_ghost";
    r4.code = r1.code;
    fall.createWhen = { op: "equals", columnId: "col_lost", value: "x" };
    fall.idRule = { parts: [{ literal: "ae" }, { columnId: "col_lost" }] };
    file.mappings.push({
      id: "map_ref",
      code: "R-090",
      instanceId: "ins_ae0",
      path: "subject",
      transform: { kind: "reference", targetInstanceId: "ins_ghost", via: "rel_ghost" },
    });
    return file;
  }

  it("is written without errors and names every dangling reference", () => {
    const sheets = mappingTables(broken());
    const mapping = sheet(sheets, "Mapping").rows;
    expect(mapping[0]?.slice(0, 3)).toEqual(["R-001", "MotuPatient", "unknown column col_ghost"]);
    expect(mapping[0]?.[8]).toBe("unknown column col_lost is not empty");
    expect(mapping[1]?.[7]).toBe("value map unknown value map vm_ghost");
    expect(mapping[2]?.slice(1, 2)).toEqual([""]);
    expect(mapping[2]?.[5]).toBe("unknown role ins_ghost");
    expect(mapping[3]?.[0]).toBe("R-001");
    expect(mapping.at(-1)?.[7]).toBe("reference to unknown role ins_ghost via rel_ghost");
    const fallRole = sheet(sheets, "Roles").rows.find((r) => r[0]?.startsWith("AdverseEvent[0]"));
    expect(fallRole?.slice(4, 6)).toEqual([
      "unknown column col_lost = 'x'",
      "'ae' + unknown column col_lost (hash)",
    ]);
  });
});

describe("CSV", () => {
  const table: Sheet = {
    name: "T",
    header: ["a", "b"],
    rows: [
      ["=SUM(1)", "-1"],
      ["+1", "-0.5"],
      ["@x", "-x"],
      ["\tx", "plain"],
      ['say "hi"', "a,b"],
      ["line\nbreak", "a;b"],
    ],
  };

  it("escapes formulas, keeps negative numbers, quotes when needed, with BOM and CRLF", () => {
    expect(toCsv(table)).toBe(
      '\uFEFFa,b\r\n\'=SUM(1),-1\r\n\'+1,-0.5\r\n\'@x,\'-x\r\n\'\tx,plain\r\n"say ""hi""","a,b"\r\n"line\nbreak",a;b\r\n',
    );
  });

  it("uses another delimiter, such as ';' for Italian Excel", () => {
    expect(toCsv(table, { delimiter: ";" }).split("\r\n").slice(5, 7)).toEqual([
      '"say ""hi""";a,b',
      '"line\nbreak";"a;b"',
    ]);
    expect(() => toCsv(table, { delimiter: ";;" })).toThrow(/one character/);
    expect(() => toCsv(table, { delimiter: '"' })).toThrow(/one character/);
  });

  it("recognises what a spreadsheet would read as a formula", () => {
    expect(["=1", "+1", "@a", "\t1", "\r1", "-a", "-"].every(looksLikeFormula)).toBe(true);
    expect(["-1", "-0.5", "1", "a=b", ""].some(looksLikeFormula)).toBe(false);
  });
});

describe("XLSX", () => {
  const sheets = mappingTables(project(metastraProject));
  const options = { createdAt: "2026-11-12T10:20:30Z" };

  it("writes the OOXML parts in a deterministic zip", () => {
    const zip = toXlsx(sheets, options);
    expect(toXlsx(sheets, options)).toEqual(zip);
    const entries = unzipSync(zip);
    const parts = xlsxParts(sheets, options);
    expect(Object.keys(entries).sort()).toEqual([...parts.keys()].sort());
    for (const [path, text] of parts)
      expect(strFromU8(entries[path] ?? new Uint8Array())).toBe(text);
    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
      "xl/worksheets/sheet4.xml",
    ]);
    expect(parts.get("docProps/core.xml")).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-12T10:20:30Z</dcterms:created>',
    );
  });

  it("writes inline strings only, never formulas and never the CSV escape", () => {
    const parts = xlsxParts([{ name: "T", header: ["a"], rows: [["=SUM(1)"], ["-x"]] }], options);
    const xml = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(xml).not.toContain("<f>");
    expect(xml).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">=SUM(1)</t></is></c>',
    );
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('<autoFilter ref="A1:A3"/>');
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="T" sheetId="1" r:id="rId1"/>');
  });

  it("escapes XML and characters XML does not allow", () => {
    expect(xmlText('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
    expect(xmlText("x\u0001y\u000Bz\tw")).toBe("x_x0001_y_x000B_z\tw");
    expect(xmlText("_x0041_")).toBe("_x005F_x0041_");
  });

  it("names columns A to Z, then AA", () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
  });
});
