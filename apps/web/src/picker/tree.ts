/**
 * The element tree of the path picker (D3): one level at a time from `@cindermed/fhir-defs`
 * (`elementTree`, documents loaded on demand), and the lines shown for the opened nodes and the
 * search. Backbone elements (inline children, no extra document) are loaded with their parent, so
 * the search finds `component.value…`; complex datatypes are searched once opened.
 */
import {
  type FhirDefinitions,
  type IndexFetch,
  type TreeNode,
  elementTree,
  withDefinitions,
} from "@cindermed/fhir-defs";
import type { Instance } from "@cindermed/model";

/** The definition a role's paths resolve in: its profile when known, else its resource type. */
export function roleDefinition(defs: FhirDefinitions, role: Instance): string | undefined {
  if (role.profile !== undefined) {
    const entry = defs.entry(role.profile);
    if (entry?.kind === "resource" && entry.type === role.resourceType) return role.profile;
  }
  return defs.resourceTypes().includes(role.resourceType) ? role.resourceType : undefined;
}

const INLINE = new Set(["BackboneElement", "Element"]);
const isInline = (node: TreeNode) =>
  node.expandable && node.types.length === 1 && INLINE.has(node.types[0]?.code ?? "");

/** The loaded levels: the children of each path ("" is the root). */
export type Levels = ReadonlyMap<string, readonly TreeNode[]>;

/**
 * Loads the level under `path`, and the backbone levels under it (to `depth`). Levels already
 * loaded are kept. Returns the new levels, or why the level could not be read.
 */
export async function loadLevels(
  defs: FhirDefinitions,
  fetch: IndexFetch,
  ref: string,
  path: string,
  levels: Levels,
  depth = 4,
): Promise<{ readonly levels: Levels } | { readonly message: string }> {
  const next = new Map(levels);
  const load = async (at: string, left: number): Promise<string | undefined> => {
    if (!next.has(at)) {
      const tree = await withDefinitions(defs, fetch, () => elementTree(defs, ref, at));
      if (!tree.ok) return tree.issue.message;
      next.set(at, tree.value);
    }
    if (left === 0) return undefined;
    for (const node of next.get(at) ?? []) if (isInline(node)) await load(node.path, left - 1);
    return undefined;
  };
  const message = await load(path, depth);
  return message === undefined ? { levels: next } : { message };
}

export interface TreeLine {
  readonly node: TreeNode;
  readonly depth: number;
  readonly expanded: boolean;
}

/**
 * The lines to show. Without a search: the root level and the children of opened nodes. With a
 * search: the loaded nodes whose name or path contains it, with their ancestors, opened.
 */
export function treeLines(
  levels: Levels,
  expanded: ReadonlySet<string>,
  query: string,
): TreeLine[] {
  const text = query.trim().toLowerCase();
  const matches = (node: TreeNode) =>
    node.name.toLowerCase().includes(text) || node.path.toLowerCase().includes(text);
  const hasMatch = (node: TreeNode): boolean =>
    matches(node) || (levels.get(node.path) ?? []).some(hasMatch);
  const lines: TreeLine[] = [];
  const walk = (path: string, depth: number) => {
    for (const node of levels.get(path) ?? []) {
      if (text !== "" && !hasMatch(node)) continue;
      const children = levels.get(node.path);
      const open =
        text !== ""
          ? (children ?? []).some(hasMatch)
          : expanded.has(node.path) && children !== undefined;
      lines.push({ node, depth, expanded: open });
      if (open) walk(node.path, depth + 1);
    }
  };
  walk("", 0);
  return lines;
}

/** The cardinality as `min..max`. */
export const cardinality = (node: TreeNode) => `${String(node.min)}..${node.max}`;
