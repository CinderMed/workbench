/**
 * The mapping table as an XLSX workbook (Office Open XML SpreadsheetML), written without a
 * spreadsheet library: one worksheet per sheet, every cell an inline string (never a formula, so no
 * escaping is needed), a bold header row that stays visible when scrolling, an autofilter and column
 * widths from the content. The parts go into the deterministic zip of ADR-0012, and the document
 * date is `createdAt`, so the same table and date always give the same bytes.
 */
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { Sheet } from "./mapping-table.js";
import { deterministicZip } from "./zip.js";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_WIDTH = 60;

/**
 * Text for an XML element: markup characters escaped; characters XML 1.0 does not allow written as
 * OOXML `_xHHHH_` escapes (and a literal `_xHHHH_` protected), as spreadsheet programs expect.
 */
export function xmlText(text: string): string {
  const escaped = Array.from(text.replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1"), (c) => {
    const code = c.codePointAt(0) ?? 0;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
    return allowed ? c : `_x${code.toString(16).toUpperCase().padStart(4, "0")}_`;
  }).join("");
  return escaped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cell(ref: string, text: string, style: number): string {
  const s = style === 0 ? "" : ` s="${String(style)}"`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function worksheet(sheet: Sheet): string {
  const all = [sheet.header, ...sheet.rows];
  /** Display width of a cell: its longest line, in characters. */
  const width = (text: string): number =>
    Math.max(0, ...text.split("\n").map((line) => Array.from(line).length));
  const widths = sheet.header.map((_, i) =>
    Math.min(MAX_WIDTH, Math.max(8, ...all.map((row) => width(row[i] ?? ""))) + 2),
  );
  const last = columnName(Math.max(sheet.header.length - 1, 0));
  const rows = all
    .map((row, r) => {
      const n = String(r + 1);
      return `<row r="${n}">${row.map((text, c) => cell(`${columnName(c)}${n}`, text, r === 0 ? 1 : 0)).join("")}</row>`;
    })
    .join("");
  return (
    `${XML}<worksheet xmlns="${NS}" xmlns:r="${REL}">` +
    `<dimension ref="A1:${last}${String(all.length)}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    `<autoFilter ref="A1:${last}${String(all.length)}"/>` +
    `</worksheet>`
  );
}

export interface XlsxOptions {
  /** ISO 8601 date-time: the document date and the timestamp of every zip entry. */
  readonly createdAt: string;
}

/** The parts of the workbook, by path inside the zip. */
export function xlsxParts(sheets: readonly Sheet[], options: XlsxOptions): Map<string, string> {
  const parts = new Map<string, string>();
  const created = `${new Date(options.createdAt).toISOString().slice(0, 19)}Z`;
  parts.set(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`,
  );
  parts.set(
    "_rels/.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`,
  );
  parts.set(
    "docProps/core.xml",
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>Mapping table</dc:title><dc:creator>cindermed</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
      `</cp:coreProperties>`,
  );
  parts.set(
    "xl/workbook.xml",
    `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>` +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${xmlText(sheet.name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
        )
        .join("") +
      `</sheets>` +
      `</workbook>`,
  );
  parts.set(
    "xl/_rels/workbook.xml.rels",
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${String(i + 1)}" Type="${REL}/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${String(sheets.length + 1)}" Type="${REL}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  parts.set(
    "xl/styles.xml",
    `${XML}<styleSheet xmlns="${NS}">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`,
  );
  sheets.forEach((sheet, i) =>
    parts.set(`xl/worksheets/sheet${String(i + 1)}.xml`, worksheet(sheet)),
  );
  return parts;
}

/** The workbook as XLSX bytes. */
export function toXlsx(sheets: readonly Sheet[], options: XlsxOptions): Uint8Array {
  const parts = xlsxParts(sheets, options);
  return deterministicZip(
    new Map([...parts].map(([path, text]) => [path, utf8ToBytes(text)])),
    options.createdAt,
  );
}
