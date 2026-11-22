// The comparison of the engine's compilation with our StructureMap JSON (ADR-0007 addendum, #78):
// R4 sets aside only `status`; R5 sets aside the closed list of engine defects, each in its exact
// form and only on the engine's side, and any other difference fails Golden.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENGINE_RESOURCE_DEFINITION,
  R5_ENGINE_DEFECTS,
  compareStructureMaps,
} from "./golden/compare-structuremap.mjs";

const root = join(import.meta.dirname, "..");
const ours = JSON.parse(
  readFileSync(join(root, "fixtures/fml-examples/r5-visit/StructureMap-Visit.json"), "utf8"),
) as Record<string, unknown>;

/** Our R5 JSON with every listed engine defect applied, as validator 7.0.5 writes it. */
function withEngineDefects(map: unknown): unknown {
  function walk(value: unknown, key: string | undefined, inRule: boolean): unknown {
    if (Array.isArray(value)) return value.map((item) => walk(item, undefined, key === "rule"));
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(value)) {
      if (k === "element" && typeof item === "string") out[k] = [item];
      else if (k === "name" && inRule && typeof item === "string")
        out[k] = item.replaceAll("-", "");
      else if (k === "condition" && typeof item === "string")
        out[k] = item.replace(/^\((.*)\)$/s, "$1");
      else out[k] = walk(item, k, false);
    }
    if (inRule) out["documentation"] = "a comment";
    return out;
  }
  const engine = walk(map, undefined, false) as Record<string, unknown>;
  delete engine["text"];
  delete engine["status"];
  engine["resourceDefinition"] = ENGINE_RESOURCE_DEFINITION;
  return engine;
}

const clone = <T>(value: T): T => structuredClone(value);

describe("compareStructureMaps", () => {
  it("R5: sets aside every listed defect, and only those", () => {
    const result = compareStructureMaps(withEngineDefects(ours), ours, "5.0.0");
    expect(result.differences).toEqual([]);
    expect(result.setAside.sort()).toEqual(Object.keys(R5_ENGINE_DEFECTS).sort());
  });

  it("R5: equal maps set nothing aside", () => {
    expect(compareStructureMaps(clone(ours), ours, "5.0.0")).toEqual({
      differences: [],
      setAside: [],
    });
  });

  it("R4: the defects are differences", () => {
    const result = compareStructureMaps(withEngineDefects(ours), ours, "4.0.1");
    expect(result.setAside).toEqual([]);
    expect(result.differences).toContain(".resourceDefinition (only in the engine's)");
    expect(result.differences).toContain(".text (only in ours)");
  });

  it("R5: any difference outside the list fails", () => {
    const engine = withEngineDefects(ours) as {
      group: { rule: { name: string }[] }[];
      url: string;
    };
    engine.url = "http://example.org/other";
    expect(compareStructureMaps(engine, ours, "5.0.0").differences).toEqual([
      `.url ("http://example.org/other" ≠ ${JSON.stringify(ours["url"])})`,
    ]);
  });

  it("R5: a defect only in its exact form, only on the engine's side", () => {
    const cases: [string, (engine: Record<string, unknown>) => void][] = [
      // A two-item `element` array is not the one-item defect.
      ["element", (e) => (item(first(e)["target"], 0)["element"] = ["type", "x"])],
      // A rule name that lost more than its hyphens.
      ["name", (e) => (first(e)["name"] = "bundle")],
      // Another resourceDefinition.
      ["resourceDefinition", (e) => (e["resourceDefinition"] = "http://example.org/sd")],
      // Narrative on the engine's side that ours lacks is not "no narrative".
      ["text", (e) => (e["text"] = { status: "generated", div: "<div/>" })],
    ];
    for (const [key, change] of cases) {
      const engine = withEngineDefects(ours) as Record<string, unknown>;
      change(engine);
      const { differences } = compareStructureMaps(engine, ours, "5.0.0");
      expect(
        differences.some((d) => d.includes(key)),
        key,
      ).toBe(true);
    }
    // Documentation in ours that the engine lacks is a difference, not the comment defect.
    const withDocs = clone(ours);
    item(withDocs["group"], 0)["documentation"] = "ours";
    expect(compareStructureMaps(withEngineDefects(ours), withDocs, "5.0.0").differences).toContain(
      ".group[0].documentation (only in ours)",
    );
  });
});

/** The i-th object of an array, or a failed test. */
function item(list: unknown, i: number): Record<string, unknown> {
  const found: unknown = Array.isArray(list) ? list[i] : undefined;
  if (found === null || typeof found !== "object") throw new Error(`no object at ${String(i)}`);
  return found as Record<string, unknown>;
}

/** The first rule of the first group. */
const first = (engine: Record<string, unknown>) => item(item(engine["group"], 0)["rule"], 0);
