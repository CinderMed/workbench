import { describe, expect, it } from "vitest";
import hospitalStayText from "../../../fixtures/fml-examples/motu/HospitalStay.map?raw";
import { groupName, ident, ruleName, type Expr, type StructureMapAst } from "./fml-ast.js";
import {
  FmlPrintError,
  printExpr,
  printLiteral,
  printMap,
  printMapWithLines,
  quoteString,
  ruleAtLine,
} from "./fml-print.js";
import { hospitalStay } from "./test-support/hospital-stay.js";

const src = ident("src");
const res = ident("res");

function smallMap(overrides: Partial<StructureMapAst> = {}): StructureMapAst {
  return {
    url: "http://example.org/fhir/test/StructureMap/T",
    name: groupName("T"),
    uses: [],
    groups: [
      {
        name: groupName("T"),
        params: [
          { mode: "source", name: src },
          { mode: "target", name: res },
        ],
        rules: [],
      },
    ],
    ...overrides,
  };
}

describe("printMap", () => {
  it("prints the HospitalStay tree byte-identical to the verified map", () => {
    expect(printMap(hospitalStay)).toBe(hospitalStayText);
  });

  it("is deterministic", () => {
    expect(printMap(hospitalStay)).toBe(
      printMap(JSON.parse(JSON.stringify(hospitalStay)) as StructureMapAst),
    );
  });

  it("prints groups without parameter types, rules without targets and group comments", () => {
    const map = smallMap({
      groups: [
        {
          name: groupName("T"),
          comment: "main group\nsecond line",
          params: [
            { mode: "source", name: src },
            { mode: "target", name: res },
          ],
          rules: [
            {
              name: ruleName("call"),
              source: { context: src },
              targets: [],
              then: { kind: "invoke", group: groupName("Other"), args: [src, res] },
            },
          ],
        },
      ],
    });
    expect(printMap(map)).toBe(
      [
        'map "http://example.org/fhir/test/StructureMap/T" = `T`',
        "",
        "",
        "// main group",
        "// second line",
        "group T(source src, target res) {",
        '  src then Other(src, res) "call";',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("ignores empty comments and splits comments on any line break", () => {
    const map = smallMap({
      groups: [
        {
          name: groupName("T"),
          params: [
            { mode: "source", name: src },
            { mode: "target", name: res },
          ],
          rules: [
            { name: ruleName("a"), comment: "", source: { context: src }, targets: [] },
            {
              name: ruleName("b"),
              comment: "one\r\ntwo\rthree",
              source: { context: src },
              targets: [],
            },
          ],
        },
      ],
    });
    expect(printMap(map)).toContain('  src "a";\n  // one\n  // two\n  // three\n  src "b";\n');
  });

  it("rejects URLs that cannot be written between double quotes", () => {
    for (const url of ["", 'http://x/"a"', "http://x/a b", "http://x\\a", "http://x/\n"]) {
      expect(() => printMap(smallMap({ url }))).toThrow(FmlPrintError);
    }
    expect(() =>
      printMap(smallMap({ uses: [{ url: "bad url", alias: ident("X"), mode: "source" }] })),
    ).toThrow(/URL is not valid/);
  });
});

describe("printMapWithLines", () => {
  const printed = printMapWithLines(hospitalStay);
  const lines = printed.text.split("\n");

  it("returns one entry per printed line", () => {
    expect(printed.lineRules).toHaveLength(lines.length - 1);
  });

  it("assigns every line to its innermost rule", () => {
    const at = (fragment: string): string | null =>
      ruleAtLine(printed, lines.findIndex((l) => l.includes(fragment)) + 1);
    expect(at("map ")).toBeNull();
    expect(at("uses ")).toBeNull();
    expect(at("group HospitalStay(")).toBeNull();
    expect(at("bundle.type")).toBe("bundle-type");
    expect(at("// Encounter[0]")).toBe("Encounter0");
    expect(at("src where ($this.id_Encounter0")).toBe("Encounter0");
    expect(at("src.id_Encounter0 as i")).toBe("Encounter0-id");
    expect(at("then Encounter0(src, res)")).toBe("Encounter0-body");
    expect(at('} "Encounter0";')).toBe("Encounter0");
    expect(at("p.start")).toBe("R-004");
    expect(at('} "Encounter0-period";')).toBe("Encounter0-period");
    expect(at("// R-006")).toBe("R-006");
  });

  it("returns null outside the text", () => {
    expect(ruleAtLine(printed, 0)).toBeNull();
    expect(ruleAtLine(printed, 10_000)).toBeNull();
  });
});

describe("printExpr", () => {
  const col = ident("cond_osteoporosis_yn");

  it("prints the condition forms of the translation rules", () => {
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
    expect(printExpr(expr)).toBe(
      "$this.id_Condition1.exists() and ($this.cond_osteoporosis_yn.where($this = '1' or $this = '-1').exists() and $this.cond_osteoporosis_yn.where($this = '0').empty())",
    );
  });

  it("prints not, thisEquals, prefixThis and raw expressions", () => {
    expect(printExpr({ kind: "not", arg: { kind: "exists", column: ident("A") } })).toBe(
      "($this.A.exists()).not()",
    );
    expect(printExpr({ kind: "thisEquals", value: "-1" })).toBe("$this = '-1'");
    expect(printExpr({ kind: "thisEquals", value: 3 })).toBe("$this = 3");
    expect(printExpr({ kind: "prefixThis", prefix: "Patient/" })).toBe("'Patient/' + $this");
    expect(printExpr({ kind: "raw", text: "$this.a + 1" })).toBe("$this.a + 1");
    expect(
      printExpr({
        kind: "or",
        args: [
          { kind: "exists", column: ident("a") },
          {
            kind: "or",
            args: [
              { kind: "exists", column: ident("b") },
              { kind: "exists", column: ident("c") },
            ],
          },
        ],
      }),
    ).toBe("$this.a.exists() or ($this.b.exists() or $this.c.exists())");
  });
});

describe("literals and strings", () => {
  it("escapes quotes, backslashes and control characters", () => {
    expect(quoteString("it's")).toBe("'it\\'s'");
    expect(quoteString("a\\b")).toBe("'a\\\\b'");
    expect(quoteString("a\nb\r\tc\f")).toBe("'a\\nb\\r\\tc\\f'");
    expect(quoteString("\u0001\u007f")).toBe("'\\u0001\\u007f'");
    expect(quoteString("Sì · —")).toBe("'Sì · —'");
  });

  it("prints booleans and unsigned numbers", () => {
    expect(printLiteral(true)).toBe("true");
    expect(printLiteral(false)).toBe("false");
    expect(printLiteral(3)).toBe("3");
    expect(printLiteral(11.2)).toBe("11.2");
  });

  it("rejects numbers the grammar has no token for", () => {
    for (const value of [-1, 1e21, 1e-7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => printLiteral(value)).toThrow(FmlPrintError);
    }
    expect(new FmlPrintError("x").name).toBe("FmlPrintError");
  });

  it("prints every transform", () => {
    const map = smallMap({
      groups: [
        {
          name: groupName("T"),
          params: [
            { mode: "source", name: src },
            { mode: "target", name: res },
          ],
          rules: [
            {
              name: ruleName("all"),
              source: {
                context: src,
                element: ident("a"),
                alias: ident("v"),
                where: { kind: "thisEquals", value: "x" },
              },
              targets: [
                { context: res, element: ident("n"), transform: { kind: "literal", value: 2 } },
                { context: res, element: ident("b"), transform: { kind: "literal", value: true } },
                {
                  context: res,
                  element: ident("code"),
                  transform: { kind: "c", system: "http://s", code: "1" },
                },
                {
                  context: res,
                  element: ident("cc"),
                  transform: { kind: "cc", system: "http://s", code: "1", display: "One" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(printMap(map)).toContain(
      "  src.a as v where ($this = 'x') -> res.n = 2, res.b = true, res.code = c('http://s', '1'), res.cc = cc('http://s', '1', 'One') \"all\";\n",
    );
  });
});
