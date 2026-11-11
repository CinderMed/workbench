/**
 * Canonical key order of a JSON document, guided by its JSON Schema (ADR-0006).
 *
 * Keys an object schema declares come first, in the order of its `properties`. Every other key
 * (open maps such as `extensions` or `typeRules`) follows in code-unit order. Arrays keep their
 * order, because it carries meaning (rows, entries, columns).
 */
type SchemaNode = Readonly<Record<string, unknown>>;

const COMPOSITION_KEYWORDS = ["allOf", "anyOf", "oneOf"] as const;
const CONDITIONAL_KEYWORDS = ["then", "else"] as const;

function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Follows a local `$ref` such as `#/$defs/Column`. */
function resolveRef(node: SchemaNode, root: SchemaNode): SchemaNode {
  const ref = node["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return node;
  let target: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    target = isNode(target) ? target[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
  }
  return isNode(target) ? target : node;
}

/** The node and every subschema that can describe the same value (`$ref`, `allOf`, `oneOf`, `then`…). */
function expand(nodes: readonly SchemaNode[], root: SchemaNode): SchemaNode[] {
  const result: SchemaNode[] = [];
  const pending = [...nodes];
  const seen = new Set<SchemaNode>();
  while (pending.length > 0) {
    const node = pending.shift();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    result.push(node);
    const resolved = resolveRef(node, root);
    if (resolved !== node) pending.push(resolved);
    for (const keyword of COMPOSITION_KEYWORDS) {
      const branches = node[keyword];
      if (Array.isArray(branches)) pending.push(...branches.filter(isNode));
    }
    for (const keyword of CONDITIONAL_KEYWORDS) {
      const branch = node[keyword];
      if (isNode(branch)) pending.push(branch);
    }
  }
  return result;
}

function declaredKeys(nodes: readonly SchemaNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    const properties = node["properties"];
    if (!isNode(properties)) continue;
    for (const key of Object.keys(properties)) if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function propertySchemas(nodes: readonly SchemaNode[], key: string): SchemaNode[] {
  const result: SchemaNode[] = [];
  for (const node of nodes) {
    const properties = node["properties"];
    const declared = isNode(properties) ? properties[key] : undefined;
    if (isNode(declared)) result.push(declared);
  }
  if (result.length > 0) return result;
  for (const node of nodes) {
    const additional = node["additionalProperties"];
    if (isNode(additional)) result.push(additional);
  }
  return result;
}

function itemSchemas(nodes: readonly SchemaNode[]): SchemaNode[] {
  const result: SchemaNode[] = [];
  for (const node of nodes) {
    const items = node["items"];
    if (isNode(items)) result.push(items);
  }
  return result;
}

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function orderValue(value: unknown, nodes: readonly SchemaNode[], root: SchemaNode): unknown {
  const schemas = expand(nodes, root);
  if (Array.isArray(value)) {
    const items = itemSchemas(schemas);
    return value.map((item: unknown) => orderValue(item, items, root));
  }
  if (typeof value !== "object" || value === null) return value;
  const object = value as Readonly<Record<string, unknown>>;
  const declared = declaredKeys(schemas).filter((key) => Object.hasOwn(object, key));
  const others = Object.keys(object)
    .filter((key) => !declared.includes(key))
    .sort(compareCodeUnits);
  const ordered: Record<string, unknown> = {};
  for (const key of [...declared, ...others]) {
    ordered[key] = orderValue(object[key], propertySchemas(schemas, key), root);
  }
  return ordered;
}

/** Returns a copy of `value` whose object keys follow the canonical order of `schema`. */
export function orderKeys(value: unknown, schema: SchemaNode): unknown {
  return orderValue(value, [schema], schema);
}
