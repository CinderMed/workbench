import { describe, expect, it } from "vitest";
import firstOverview from "../../../fixtures/fml-examples/metastra/FirstOverview.map?raw";
import fall from "../../../fixtures/fml-examples/motu/Fall.map?raw";
import hospitalStayText from "../../../fixtures/fml-examples/motu/HospitalStay.map?raw";
import motuPatient from "../../../fixtures/fml-examples/motu/MotuPatient.map?raw";
import reservedWordsAccepted from "../../../fixtures/fml-examples/tests/reserved-words/Test.map?raw";
import reservedWords from "../../../fixtures/fml-examples/tests/reserved-words/syntax/Kw.map?raw";
import { groupName, ident, ruleName, type StructureMapAst } from "./fml-ast.js";
import { printMapWithLines, type PrintedMap } from "./fml-print.js";
import { FML_GRAMMAR_ERROR, GRAMMAR_COMMIT, checkGrammar, parseFml } from "./grammar-check.js";
import { hospitalStay } from "./test-support/hospital-stay.js";

const fallback = { objectKind: "source", id: "src_hospitalstay" } as const;

describe("parseFml", () => {
  it.each([
    ["metastra/FirstOverview.map", firstOverview],
    ["motu/MotuPatient.map", motuPatient],
    ["motu/HospitalStay.map", hospitalStayText],
    ["motu/Fall.map", fall],
    ["tests/reserved-words/Test.map", reservedWordsAccepted],
  ])("accepts the verified map %s", (_name, text) => {
    expect(parseFml(text)).toEqual([]);
  });

  it("rejects exactly the four reserved words the grammar does not accept", () => {
    const lines = reservedWords.split("\n");
    const lineOf = (word: string): number =>
      lines.findIndex((line) => line.includes(`"r-${word}"`)) + 1;
    const expected = ["share", "default", "log", "then"].map(lineOf);
    const errorLines = new Set(parseFml(reservedWords).map((error) => error.line));
    expect([...errorLines].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  });

  it("reports lexer errors with line and column", () => {
    const errors = parseFml(
      'map "http://x/StructureMap/T" = `T`\n\ngroup T(source src, target tgt) {\n  src -> tgt.a = # "r";\n}\n',
    );
    expect(errors[0]).toMatchObject({ line: 4, column: 17 });
    expect(errors[0]?.message).toContain("#");
  });

  it("rejects a text without groups", () => {
    expect(parseFml('map "http://x/StructureMap/T" = `T`\n').length).toBeGreaterThan(0);
  });
});

describe("checkGrammar", () => {
  it("accepts the printed HospitalStay map", () => {
    expect(checkGrammar(printMapWithLines(hospitalStay), { fallback })).toEqual([]);
  });

  const src = ident("src");
  const tgt = ident("tgt");
  const broken: StructureMapAst = {
    url: "http://example.org/fhir/test/StructureMap/T",
    name: groupName("T"),
    uses: [],
    groups: [
      {
        name: groupName("T"),
        params: [
          { mode: "source", name: src },
          { mode: "target", name: tgt },
        ],
        rules: [
          {
            name: ruleName("R-001"),
            source: { context: src, element: ident("a"), alias: ident("v") },
            targets: [
              {
                context: tgt,
                element: ident("a"),
                transform: { kind: "copy", variable: ident("v") },
              },
            ],
          },
          {
            name: ruleName("R-002"),
            comment: "expert expression (D6) with a syntax error",
            source: { context: src, where: { kind: "raw", text: "$this.b.exists(" } },
            targets: [
              { context: tgt, element: ident("b"), transform: { kind: "literal", value: "x" } },
            ],
          },
        ],
      },
    ],
  };

  it("traces an error back to the rule and to the mapping row that produced it", () => {
    const results = checkGrammar(printMapWithLines(broken), {
      fallback,
      ownerOf: (rule) => (rule === "R-002" ? { objectKind: "mapping", id: "map_0002" } : undefined),
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result).toMatchObject({
        severity: "error",
        code: FML_GRAMMAR_ERROR,
        objectKind: "mapping",
        id: "map_0002",
      });
      expect(result.message).toContain(`mapping.g4 @${GRAMMAR_COMMIT}`);
      expect(result.message).toContain('rule "R-002"');
    }
  });

  it("falls back to the given owner for rules without one", () => {
    const [first] = checkGrammar(printMapWithLines(broken), { fallback });
    expect(first).toMatchObject({ objectKind: "source", id: "src_hospitalstay" });
  });

  it("falls back for errors outside rules and leaves the rule out of the message", () => {
    const printed: PrintedMap = {
      text: 'map "http://x/StructureMap/T" = `T`\n',
      lineRules: [null],
    };
    const results = checkGrammar(printed, { fallback: { objectKind: "source" } });
    const [first] = results;
    expect(first && Object.keys(first).sort()).toEqual([
      "code",
      "message",
      "objectKind",
      "severity",
    ]);
    expect(first).toMatchObject({
      severity: "error",
      code: FML_GRAMMAR_ERROR,
      objectKind: "source",
    });
    expect(first?.message).toMatch(/^FML grammar \(mapping\.g4 @8bb04b4\), line 2:0: /);
    expect(first?.message).not.toContain("rule");
  });
});
