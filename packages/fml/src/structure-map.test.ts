import { describe, expect, it } from "vitest";
import compiledHospitalStay from "../../../fixtures/fml-examples/motu/StructureMap-HospitalStay.json" with { type: "json" };
import { groupName, ident, ruleName, type Expr, type StructureMapAst } from "./fml-ast.js";
import { FmlPrintError } from "./fml-print.js";
import { renderFhirPath, toStructureMap } from "./structure-map.js";
import { hospitalStay } from "./test-support/hospital-stay.js";

const src = ident("src");
const res = ident("res");

function oneRuleMap(rule: StructureMapAst["groups"][number]["rules"][number]): StructureMapAst {
  return {
    url: "http://example.org/fhir/test/StructureMap/T",
    name: groupName("T"),
    uses: [
      {
        url: "http://example.org/fhir/test/StructureDefinition/TRow",
        alias: ident("TRow"),
        mode: "source",
      },
    ],
    groups: [
      {
        name: groupName("T"),
        params: [
          { mode: "source", name: src, type: ident("TRow") },
          { mode: "target", name: res },
        ],
        rules: [rule],
      },
    ],
  };
}

describe("toStructureMap (R4)", () => {
  it("equals the StructureMap compiled by the HL7 engine from the HospitalStay map", () => {
    expect(toStructureMap(hospitalStay, { fhirRelease: "R4" })).toEqual(compiledHospitalStay);
  });

  it("writes number and boolean constants with their value type", () => {
    const map = oneRuleMap({
      name: ruleName("constants"),
      source: { context: src },
      targets: [
        { context: res, element: ident("i"), transform: { kind: "literal", value: 3 } },
        { context: res, element: ident("d"), transform: { kind: "literal", value: 1.5 } },
        { context: res, element: ident("b"), transform: { kind: "literal", value: false } },
      ],
    });
    const rule = toStructureMap(map, { fhirRelease: "R4" }).group[0]?.rule[0];
    expect(rule?.target?.map((t) => [t.transform, t.parameter])).toEqual([
      ["copy", [{ valueInteger: 3 }]],
      ["copy", [{ valueDecimal: 1.5 }]],
      ["copy", [{ valueBoolean: false }]],
    ]);
  });

  it("rejects number constants the grammar cannot print", () => {
    const map = oneRuleMap({
      name: ruleName("negative"),
      source: { context: src },
      targets: [{ context: res, element: ident("i"), transform: { kind: "literal", value: -3 } }],
    });
    expect(() => toStructureMap(map, { fhirRelease: "R4" })).toThrow(FmlPrintError);
  });

  it("escapes the narrative as XHTML", () => {
    const map = oneRuleMap({
      name: ruleName("x"),
      comment: 'a < b & "c" > d',
      source: { context: src },
      targets: [],
    });
    expect(toStructureMap(map, { fhirRelease: "R4" }).text.div).toContain(
      "// a &lt; b &amp; &quot;c&quot; &gt; d",
    );
  });

  it("keeps a source without condition and a group input without type", () => {
    const json = toStructureMap(
      oneRuleMap({ name: ruleName("x"), source: { context: src }, targets: [] }),
      {
        fhirRelease: "R4",
      },
    );
    expect(json.group[0]?.input).toEqual([
      { name: "src", type: "TRow", mode: "source" },
      { name: "res", mode: "target" },
    ]);
    expect(json.group[0]?.rule[0]).toEqual({ name: "x", source: [{ context: "src" }] });
  });
});

describe("toStructureMap (R5)", () => {
  const json = toStructureMap(hospitalStay, { fhirRelease: "R5" });

  it("has no typeMode and no contextType", () => {
    const text = JSON.stringify(json);
    expect(text).not.toContain("typeMode");
    expect(text).not.toContain("contextType");
  });

  it("passes the arguments of a dependent rule as parameters", () => {
    const body = json.group[0]?.rule[1]?.rule?.[1];
    expect(body?.dependent).toEqual([
      { name: "Encounter0", parameter: [{ valueId: "src" }, { valueId: "res" }] },
    ]);
  });

  it("otherwise equals the R4 resource", () => {
    const r4 = toStructureMap(hospitalStay, { fhirRelease: "R4" });
    expect(json.text).toEqual(r4.text);
    expect(json.structure).toEqual(r4.structure);
    expect(json.group[1]?.rule[2]?.source).toEqual(r4.group[1]?.rule[2]?.source);
  });
});

describe("renderFhirPath", () => {
  const col = ident("cond_osteoporosis_yn");

  it("groups equalities next to or, as in the compiled Metastra map", () => {
    const expr: Expr = {
      kind: "and",
      args: [
        { kind: "exists", column: ident("id_Condition1") },
        {
          kind: "and",
          args: [
            { kind: "anyOf", column: col, values: ["1", "-1"] },
            { kind: "noneOf", column: col, values: ["0"] },
          ],
        },
      ],
    };
    // fixtures/fml-examples/metastra/StructureMap-FirstOverview.json, rule Condition1
    expect(`(${renderFhirPath(expr)})`).toBe(
      "($this.id_Condition1.exists() and ($this.cond_osteoporosis_yn.where(($this = '1') or ($this = '-1')).exists() and $this.cond_osteoporosis_yn.where($this = '0').empty()))",
    );
  });

  it("renders the other expression kinds", () => {
    expect(renderFhirPath({ kind: "thisEquals", value: "0" })).toBe("$this = '0'");
    expect(renderFhirPath({ kind: "not", arg: { kind: "exists", column: ident("a") } })).toBe(
      "($this.a.exists()).not()",
    );
    expect(renderFhirPath({ kind: "prefixThis", prefix: "Patient/" })).toBe("'Patient/' + $this");
    expect(renderFhirPath({ kind: "raw", text: "$this.a" })).toBe("$this.a");
    expect(
      renderFhirPath({
        kind: "or",
        args: [
          { kind: "thisEquals", value: "a" },
          { kind: "exists", column: ident("b") },
        ],
      }),
    ).toBe("($this = 'a') or $this.b.exists()");
  });

  it("writes conditions between parentheses, as the engine does", () => {
    const json = toStructureMap(
      oneRuleMap({
        name: ruleName("R-006-0"),
        source: {
          context: src,
          element: ident("a"),
          alias: ident("v"),
          where: { kind: "thisEquals", value: "0" },
        },
        targets: [],
      }),
      { fhirRelease: "R4" },
    );
    expect(json.group[0]?.rule[0]?.source[0]).toEqual({
      context: "src",
      element: "a",
      variable: "v",
      condition: "($this = '0')",
    });
  });
});
