// Grammar-level generative tests (#76): 300 seeded random projects, schema- and integrity-valid,
// with the hard cases of test-support/random-projects.ts. Every table of every project must
// translate, print the same text twice, pass the official grammar, build its StructureMap, and give
// FHIR-safe artifacts. Compilation by the HL7 engine runs nightly on 20 of them
// (tooling/generative-compile.test.ts); full compilation-level tests come in module 3.
import { validateNormalizationSchema, validateProject } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { printMap, printMapWithLines } from "./fml-print.js";
import type { Rule, StructureMapAst } from "./fml-ast.js";
import { conceptMaps } from "./generator/concept-map.js";
import { generateMap } from "./generator/generate-map.js";
import { logicalModel } from "./generator/logical-model.js";
import { normalizationSpec } from "./generator/normalization-spec.js";
import { planTable } from "./generator/table-plan.js";
import { checkGrammar } from "./grammar.js";
import { toStructureMap } from "./structure-map.js";
import { emptyStrings } from "./test-support/empty-strings.js";
import { HARD_COLUMN_NAMES, HARD_VALUES, randomProject } from "./test-support/random-projects.js";

export const SEEDS = 300;
const FHIR_ID = /^[A-Za-z0-9.-]{1,64}$/;

/** Rule names of each group, nested rules included, that are repeated or not FHIR ids. */
function badRuleNames(map: StructureMapAst): string[] {
  const bad: string[] = [];
  for (const group of map.groups) {
    const seen = new Set<string>();
    const visit = (rules: readonly Rule[]) => {
      for (const rule of rules) {
        if (seen.has(rule.name) || !FHIR_ID.test(rule.name)) bad.push(`${group.name}/${rule.name}`);
        seen.add(rule.name);
        if (rule.then?.kind === "rules") visit(rule.then.rules);
      }
    };
    visit(group.rules);
  }
  return bad;
}

describe("generative: random projects translate to grammar-valid FML", () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))("seed %i", (seed) => {
    const project = randomProject(seed);
    expect(validateProject(project).filter((r) => r.severity === "error")).toEqual([]);
    for (const source of project.sources) {
      const planned = planTable(project, source.id);
      if (!planned.ok) throw new Error(JSON.stringify(planned.results));
      const map = generateMap(project, planned.value);
      if (!map.ok) throw new Error(JSON.stringify(map.results));
      expect(printMap(map.value)).toBe(printMap(map.value));
      expect(
        checkGrammar(printMapWithLines(map.value), {
          fallback: { objectKind: "source", id: source.id },
        }),
      ).toEqual([]);
      expect(badRuleNames(map.value)).toEqual([]);
      const spec = normalizationSpec(project, planned.value);
      expect(validateNormalizationSchema(spec)).toEqual([]);
      for (const resource of [
        toStructureMap(map.value, { fhirRelease: "R4" }),
        logicalModel(project, planned.value),
        spec,
      ]) {
        expect(emptyStrings(resource)).toEqual([]);
      }
    }
    for (const cm of conceptMaps(project, { fhirRelease: "R4" }))
      expect(emptyStrings(cm)).toEqual([]);
  });

  it("covers the hard cases across the seeds", () => {
    const projects = Array.from({ length: SEEDS }, (_, i) => randomProject(i + 1));
    const columnNames = new Set(
      projects.flatMap((p) => p.sources.flatMap((s) => s.columns.map((c) => c.name))),
    );
    const values = new Set(
      projects.flatMap((p) => p.valueMaps.flatMap((m) => m.entries.map((e) => e.sourceValue))),
    );
    for (const name of HARD_COLUMN_NAMES) expect(columnNames, name).toContain(name);
    for (const value of HARD_VALUES) expect(values, value).toContain(value);
    expect(
      projects.some((p) => p.sources.some((s) => s.columns.some((c) => c.name === "itemid"))),
    ).toBe(true);
    expect(
      projects.some((p) =>
        p.mappings.some((r) => r.transform.kind === "reference" && r.transform.via !== undefined),
      ),
    ).toBe(true);
    expect(
      projects.some((p) =>
        p.valueMaps.some((m) => m.entries.some((e) => e.action.kind === "setElement")),
      ),
    ).toBe(true);
    expect(projects.some((p) => p.mappings.some((r) => r.path.includes("[part]")))).toBe(true);
  });
});
