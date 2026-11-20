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
import { repeats, slicePath } from "../slices/slices";

type Slice = NonNullable<Instance["slices"]>[number];

/** The definition a role's paths resolve in: its profile when known, else its resource type. */
export function roleDefinition(
  defs: FhirDefinitions,
  role: Pick<Instance, "resourceType" | "profile">,
): string | undefined {
  if (role.profile !== undefined) {
    const entry = defs.entry(role.profile);
    if (entry?.kind === "resource" && entry.type === role.resourceType) return role.profile;
  }
  return defs.resourceTypes().includes(role.resourceType) ? role.resourceType : undefined;
}

const INLINE = new Set(["BackboneElement", "Element"]);
const isInline = (node: TreeNode) =>
  node.expandable && node.types.length === 1 && INLINE.has(node.types[0]?.code ?? "");

/** A node of the picker: an element, or a named slice the role declares (`sliceId`). */
export type PickerNode = TreeNode & { readonly sliceId?: string };

/**
 * The nodes of a level with the role's slices: each after its repeating element, named and
 * placed like it, holding one repetition. A profile slice of the same name is not repeated.
 */
export function withSlices(
  nodes: readonly TreeNode[],
  slices: readonly Slice[],
): readonly PickerNode[] {
  if (slices.length === 0) return nodes;
  const paths = new Set(nodes.map((n) => n.path));
  return nodes.flatMap((node): PickerNode[] => {
    if (node.sliceName !== undefined || !repeats(node)) return [node];
    const named = slices
      .filter((s) => s.path === node.path && !paths.has(slicePath(s)))
      .map((s): PickerNode => ({
        ...node,
        name: `${node.name}[${s.name}]`,
        path: slicePath(s),
        min: 0,
        max: "1",
        sliceId: s.id,
      }));
    return [node, ...named];
  });
}

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
  slices: readonly Slice[] = [],
): Promise<{ readonly levels: Levels } | { readonly message: string }> {
  const next = new Map(levels);
  const load = async (at: string, left: number): Promise<string | undefined> => {
    if (!next.has(at)) {
      const tree = await withDefinitions(defs, fetch, () => elementTree(defs, ref, at));
      if (!tree.ok) return tree.issue.message;
      next.set(at, tree.value);
    }
    if (left === 0) return undefined;
    for (const node of withSlices(next.get(at) ?? [], slices))
      if (isInline(node)) await load(node.path, left - 1);
    return undefined;
  };
  const message = await load(path, depth);
  return message === undefined ? { levels: next } : { message };
}

export interface TreeLine {
  readonly node: PickerNode;
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
  slices: readonly Slice[] = [],
): TreeLine[] {
  const text = query.trim().toLowerCase();
  const matches = (node: TreeNode) =>
    node.name.toLowerCase().includes(text) || node.path.toLowerCase().includes(text);
  const level = (path: string) => withSlices(levels.get(path) ?? [], slices);
  const hasMatch = (node: TreeNode): boolean => matches(node) || level(node.path).some(hasMatch);
  const lines: TreeLine[] = [];
  const walk = (path: string, depth: number) => {
    for (const node of level(path)) {
      if (text !== "" && !hasMatch(node)) continue;
      const open =
        text !== ""
          ? level(node.path).some(hasMatch)
          : expanded.has(node.path) && levels.has(node.path);
      lines.push({ node, depth, expanded: open });
      if (open) walk(node.path, depth + 1);
    }
  };
  walk("", 0);
  return lines;
}

/** The cardinality as `min..max`. */
export const cardinality = (node: TreeNode) => `${String(node.min)}..${node.max}`;
