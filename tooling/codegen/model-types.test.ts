import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TARGETS, generateTypes, wrapRefSiblings } from "./model-types.ts";

const model = fileURLToPath(new URL("../../packages/model/src/", import.meta.url));

// Drift check: the committed types must be exactly what the generator produces from the schemas.
describe("generated model types", () => {
  it.each(TARGETS.map((target) => [target.outputFile, target] as const))(
    "%s is up to date (run `pnpm codegen` if this fails)",
    async (_file, target) => {
      const schema = JSON.parse(
        readFileSync(`${model}schemas/${target.schemaFile}`, "utf8"),
      ) as Parameters<typeof generateTypes>[1];
      const output = `${model}generated/${target.outputFile}`;
      const expected = await generateTypes(target, schema, output);
      expect(readFileSync(output, "utf8")).toBe(expected);
    },
    30_000,
  );

  it("names the root type and emits no numbered duplicates", async () => {
    const target = TARGETS[0];
    if (target === undefined) throw new Error("no targets");
    const schema = JSON.parse(
      readFileSync(`${model}schemas/${target.schemaFile}`, "utf8"),
    ) as Parameters<typeof generateTypes>[1];
    const source = await generateTypes(target, schema, `${model}generated/${target.outputFile}`);
    expect(source).toContain("export interface ProjectFile {");
    expect(source).not.toMatch(/export (interface|type) [A-Za-z]+\d+\b/);
  }, 30_000);
});

describe("wrapRefSiblings", () => {
  it("moves the siblings of a $ref next to an allOf", () => {
    expect(wrapRefSiblings({ unit: { description: "Unit", $ref: "#/$defs/Coding" } })).toEqual({
      unit: { description: "Unit", allOf: [{ $ref: "#/$defs/Coding" }] },
    });
  });

  it("leaves a bare $ref, arrays and scalars unchanged", () => {
    const schema = { oneOf: [{ $ref: "#/$defs/A" }, { type: "string" }], const: null };
    expect(wrapRefSiblings(schema)).toEqual(schema);
  });
});
