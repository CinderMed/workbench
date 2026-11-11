// Generates the TypeScript model types of @cindermed/model from its JSON Schemas (ADR-0004).
// Pure apart from Prettier: the CLI reads the schemas and writes the files, the drift test compares.
import { compile } from "json-schema-to-typescript";
import { format, resolveConfig } from "prettier";

export interface SchemaTarget {
  /** Schema file name inside packages/model/src/schemas. */
  schemaFile: string;
  /** Output file name inside packages/model/src/generated. */
  outputFile: string;
  /** Name of the root type; replaces the schema title, which is prose. */
  rootName: string;
}

export const TARGETS: readonly SchemaTarget[] = [
  { schemaFile: "mapping-project.schema.json", outputFile: "project.ts", rootName: "ProjectFile" },
  {
    schemaFile: "normalization.schema.json",
    outputFile: "normalization.ts",
    rootName: "NormalizationSpec",
  },
  { schemaFile: "manifest.schema.json", outputFile: "manifest.ts", rootName: "ExportManifest" },
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = Record<string, Json>;

/**
 * Moves the siblings of a `$ref` (e.g. a `description`) next to an `allOf: [{ $ref }]`.
 * The schemas are contracts and stay untouched: this runs on an in-memory copy. Without it the
 * ref parser merges the siblings into a new object and the generator emits duplicates
 * such as `Coding` and `Coding1`.
 */
export function wrapRefSiblings(node: Json): Json {
  if (Array.isArray(node)) return node.map(wrapRefSiblings);
  if (node === null || typeof node !== "object") return node;
  const copy: JsonObject = {};
  for (const [key, value] of Object.entries(node)) copy[key] = wrapRefSiblings(value);
  const ref = copy["$ref"];
  if (typeof ref !== "string" || Object.keys(copy).length === 1) return copy;
  const siblings = Object.fromEntries(Object.entries(copy).filter(([key]) => key !== "$ref"));
  return { ...siblings, allOf: [{ $ref: ref }] };
}

function banner(schemaFile: string): string {
  return [
    `// Generated from src/schemas/${schemaFile} by \`pnpm codegen\` (tooling/codegen). Do not edit:`,
    "// change the schema (a contract, see CLAUDE.md) and regenerate.",
  ].join("\n");
}

/** Returns the formatted TypeScript source for one schema. */
export async function generateTypes(
  target: SchemaTarget,
  schema: Json,
  prettierConfigFile: string,
): Promise<string> {
  const prepared = wrapRefSiblings(schema);
  if (prepared === null || typeof prepared !== "object" || Array.isArray(prepared)) {
    throw new Error(`${target.schemaFile} is not a JSON object`);
  }
  // The generator names the root type after the title, or else the $id: drop both so it uses
  // rootName. Every $ref in the schemas is local (#/$defs/...), so $id is not needed to resolve them.
  delete prepared["title"];
  delete prepared["$id"];
  const source = await compile(prepared, target.rootName, {
    bannerComment: banner(target.schemaFile),
    unreachableDefinitions: true,
    format: false,
  });
  const options = (await resolveConfig(prettierConfigFile)) ?? {};
  return format(source, { ...options, parser: "typescript" });
}
