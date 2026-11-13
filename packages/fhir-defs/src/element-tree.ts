/**
 * Element trees, path resolution and reference targets (specification, "FHIR definitions engine"),
 * on the documents of a definition index (ADR-0013). Everything is synchronous over the documents
 * already loaded; when a datatype's document is missing, the answer says which one
 * (`TYPE_NOT_LOADED`), and `withDefinitions` loads it and asks again.
 *
 * Paths are project paths (`ElementPath`): relative to the role's resource, segments separated by
 * `.`, a choice element under its concrete name (`valueQuantity`), and an optional named slice
 * (`component[nrs]`).
 */
import type { FhirDefinitions, IndexFetch } from "./definitions.js";
import type {
  ElementBinding,
  ElementType,
  ElementValue,
  IndexElement,
  TypeDocument,
} from "./index-format.js";

export type PathIssueCode =
  /** The type or profile is not in the index. */
  | "DEFINITION_UNKNOWN"
  /** The document of a type or profile is needed and not loaded yet (see `type`). */
  | "TYPE_NOT_LOADED"
  /** No element with this name at this point of the path. */
  | "PATH_NOT_FOUND"
  /** A choice element (`value[x]`) used without its type (`value`), or with a type it does not allow. */
  | "CHOICE_TYPE_REQUIRED"
  /** A named slice on an element that does not repeat. */
  | "SLICE_NOT_REPEATING"
  /** `extension` or `modifierExtension`: extensions cannot be mapped in the MVP. */
  | "EXTENSION_NOT_SUPPORTED"
  /** An element the profile prohibits (`max` 0). */
  | "PATH_PROHIBITED"
  /** `referenceTargets` on an element that is not a Reference. */
  | "NOT_A_REFERENCE";

export interface PathIssue {
  readonly code: PathIssueCode;
  readonly message: string;
  /** The path asked for. */
  readonly path: string;
  /** Index of the segment where resolution stopped (0-based); absent for the root. */
  readonly segment?: number;
  /** For `TYPE_NOT_LOADED` and `DEFINITION_UNKNOWN`: the type or profile to load. */
  readonly type?: string;
}

export type PathResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: PathIssue };

/** One segment of a resolved path. */
export interface ResolvedSegment {
  /** The segment as written, without its slice (`component`, `valueQuantity`). */
  readonly name: string;
  readonly slice?: string;
  /** The element's id in its document (`Observation.component`, `Quantity.value`). */
  readonly elementId: string;
  /** URL of the document that holds the element. */
  readonly definition: string;
  readonly min: number;
  readonly max: string;
}

/** The element at the end of a path. */
export interface ResolvedElement {
  readonly path: string;
  readonly elementId: string;
  readonly definition: string;
  readonly min: number;
  readonly max: string;
  /** The element's types; for a choice, only the type chosen. */
  readonly types: readonly ElementType[];
  /** For a choice: the choice element (`value[x]`) and the type chosen (`Quantity`). */
  readonly choice?: { readonly element: string; readonly type: string };
  /** The profile slice used, when the path names one the profile defines. */
  readonly sliceName?: string;
  readonly short?: string;
  readonly binding?: ElementBinding;
  readonly fixed?: ElementValue;
  readonly pattern?: ElementValue;
  readonly isModifier?: true;
  /** Every segment, root excluded, with its cardinality. */
  readonly segments: readonly ResolvedSegment[];
}

/** One child in an element tree. */
export interface TreeNode {
  /** The segment (`valueQuantity`, `category[VSCat]`). */
  readonly name: string;
  /** The project path of the node. */
  readonly path: string;
  readonly elementId: string;
  readonly min: number;
  readonly max: string;
  readonly types: readonly ElementType[];
  readonly choice?: { readonly element: string; readonly type: string };
  readonly sliceName?: string;
  readonly short?: string;
  readonly binding?: ElementBinding;
  readonly fixed?: ElementValue;
  readonly pattern?: ElementValue;
  readonly isModifier?: true;
  readonly mustSupport?: true;
  /** Whether the node has children of its own (inline, or a complex datatype to expand). */
  readonly expandable: boolean;
}

/** What a Reference element allows. */
export interface ReferenceTargets {
  /** No target profile, or `Resource`: any resource type. */
  readonly any: boolean;
  /** The resource types allowed (all of them when `any`), sorted. */
  readonly resourceTypes: readonly string[];
  /** Target profiles that are profiles (constraints), not base resource types. */
  readonly profiles: readonly string[];
  /** Target profiles that are not in the index, or that do not define a resource. */
  readonly unknown: readonly string[];
}

const EXTENSIONS: ReadonlySet<string> = new Set(["extension", "modifierExtension"]);
/** Types whose children are inline in the snapshot, never in a document of their own. */
const INLINE_TYPES: ReadonlySet<string> = new Set(["BackboneElement", "Element"]);
const REFERENCE_TYPES: ReadonlySet<string> = new Set(["Reference", "CodeableReference"]);
const SEGMENT = /^([A-Za-z][A-Za-z0-9]*)(?:\[([^\]]+)\])?$/;

// ---------------------------------------------------------------------------------------------
// Per-document lookup tables, built once per document.

interface DocIndex {
  readonly byId: ReadonlyMap<string, IndexElement>;
  /** Direct children (not slices) by parent element id. */
  readonly children: ReadonlyMap<string, readonly IndexElement[]>;
  /** Slices by the id of the element they slice. */
  readonly slices: ReadonlyMap<string, readonly IndexElement[]>;
}

const indexes = new WeakMap<TypeDocument, DocIndex>();

function docIndex(doc: TypeDocument): DocIndex {
  const cached = indexes.get(doc);
  if (cached !== undefined) return cached;
  const byId = new Map<string, IndexElement>();
  const children = new Map<string, IndexElement[]>();
  const slices = new Map<string, IndexElement[]>();
  for (const element of doc.elements) {
    byId.set(element.id, element);
    const dot = element.id.lastIndexOf(".");
    if (dot < 0) continue;
    const parent = element.id.slice(0, dot);
    const last = element.id.slice(dot + 1);
    const colon = last.indexOf(":");
    if (colon >= 0) {
      const base = `${parent}.${last.slice(0, colon)}`;
      slices.set(base, [...(slices.get(base) ?? []), element]);
    } else children.set(parent, [...(children.get(parent) ?? []), element]);
  }
  const index = { byId, children, slices };
  indexes.set(doc, index);
  return index;
}

/** The name of an element: the last segment of its id, without a slice (`value[x]`, `family`). */
function elementName(element: IndexElement): string {
  const last = element.id.slice(element.id.lastIndexOf(".") + 1);
  const colon = last.indexOf(":");
  return colon < 0 ? last : last.slice(0, colon);
}

/** The suffix a choice type gives its element: `Quantity`, `DateTime`, `String`. */
function typeSuffix(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1);
}

const repeats = (max: string) => max === "*" || Number(max) > 1;

// ---------------------------------------------------------------------------------------------

/** A position in a document: an element and, for a choice, the type chosen. */
interface Position {
  readonly doc: TypeDocument;
  readonly element: IndexElement;
  readonly chosen?: ElementType;
}

type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: Omit<PathIssue, "path"> };

/** The root of a type or profile, if its document is loaded. */
function root(defs: FhirDefinitions, ref: string): Step<Position> {
  const entry = defs.entry(ref);
  if (entry === undefined)
    return {
      ok: false,
      issue: { code: "DEFINITION_UNKNOWN", message: `${ref} is not in the definitions`, type: ref },
    };
  const doc = defs.document(ref);
  const first = doc?.elements[0];
  if (doc === undefined || first === undefined)
    return {
      ok: false,
      issue: { code: "TYPE_NOT_LOADED", message: `${ref} is not loaded`, type: ref },
    };
  return { ok: true, value: { doc, element: first } };
}

/**
 * The elements under a position: inline children, the target of a `contentReference`, or the
 * children of its complex datatype. Primitive types and unchosen choices have none.
 */
function childrenOf(
  defs: FhirDefinitions,
  at: Position,
): Step<{ doc: TypeDocument; elements: readonly IndexElement[] }> {
  let { doc, element } = at;
  const reference = element.contentReference;
  if (reference !== undefined) {
    const target = docIndex(doc).byId.get(reference.slice(reference.indexOf("#") + 1));
    if (target !== undefined) element = target;
  }
  const inline = docIndex(doc).children.get(element.id);
  if (inline !== undefined && inline.length > 0)
    return { ok: true, value: { doc, elements: inline } };
  const types = at.chosen === undefined ? (element.type ?? []) : [at.chosen];
  const code = types.length === 1 ? types[0]?.code : undefined;
  if (code === undefined || INLINE_TYPES.has(code) || defs.entry(code)?.kind !== "complex-type")
    return { ok: true, value: { doc, elements: [] } };
  const datatype = root(defs, code);
  if (!datatype.ok) return datatype;
  doc = datatype.value.doc;
  return {
    ok: true,
    value: { doc, elements: docIndex(doc).children.get(datatype.value.element.id) ?? [] },
  };
}

/** Resolves a project path in a type or profile. */
export function resolvePath(
  defs: FhirDefinitions,
  ref: string,
  path: string,
): PathResult<ResolvedElement> {
  const fail = (issue: Omit<PathIssue, "path">): PathResult<never> => ({
    ok: false,
    issue: { ...issue, path },
  });
  const start = root(defs, ref);
  if (!start.ok) return fail(start.issue);
  let at: Position = start.value;
  let sliceName: string | undefined;
  const segments: ResolvedSegment[] = [];
  const parts = path === "" ? [] : path.split(".");
  for (const [index, part] of parts.entries()) {
    const match = SEGMENT.exec(part);
    const name = match?.[1];
    if (match === null || name === undefined)
      return fail({
        code: "PATH_NOT_FOUND",
        message: `"${part}" is not a valid path segment`,
        segment: index,
      });
    const slice = match[2];
    if (EXTENSIONS.has(name))
      return fail({
        code: "EXTENSION_NOT_SUPPORTED",
        message: `${name}: extensions cannot be mapped`,
        segment: index,
      });
    const children = childrenOf(defs, at);
    if (!children.ok) return fail({ ...children.issue, segment: index });
    const { doc, elements } = children.value;
    const found = findChild(elements, name);
    if (found === undefined) {
      const choice = elements.find((e) => elementName(e) === `${name}[x]`);
      return fail(
        choice === undefined
          ? {
              code: "PATH_NOT_FOUND",
              message: `${name} is not an element of ${at.element.id}`,
              segment: index,
            }
          : {
              code: "CHOICE_TYPE_REQUIRED",
              message: `${name} is a choice: use one of ${(choice.type ?? []).map((t) => `${name}${typeSuffix(t.code)}`).join(", ")}`,
              segment: index,
            },
      );
    }
    let { element } = found;
    const chosen = found.type;
    // A profile may constrain one type of a choice with a type slice named after it (valueQuantity).
    if (chosen !== undefined) {
      const typeSlice = docIndex(doc)
        .slices.get(element.id)
        ?.find((s) => s.sliceName === name);
      if (typeSlice !== undefined) element = typeSlice;
    }
    sliceName = undefined;
    if (slice !== undefined) {
      if (!repeats(element.max))
        return fail({
          code: "SLICE_NOT_REPEATING",
          message: `${name}[${slice}]: ${name} does not repeat (max ${element.max}), so it cannot have named slices`,
          segment: index,
        });
      const profiled = docIndex(doc)
        .slices.get(element.id)
        ?.find((s) => s.sliceName === slice);
      if (profiled !== undefined) {
        element = profiled;
        sliceName = slice;
      }
    }
    if (element.max === "0")
      return fail({
        code: "PATH_PROHIBITED",
        message: `${part} is prohibited by ${doc.url}`,
        segment: index,
      });
    segments.push({
      name,
      ...(slice === undefined ? {} : { slice }),
      elementId: element.id,
      definition: doc.url,
      min: element.min,
      max: element.max,
    });
    at = { doc, element, ...(chosen === undefined ? {} : { chosen }) };
  }
  const { doc, element, chosen } = at;
  return {
    ok: true,
    value: {
      path,
      elementId: element.id,
      definition: doc.url,
      min: element.min,
      max: element.max,
      types: chosen === undefined ? (element.type ?? []) : [chosen],
      ...(chosen === undefined
        ? {}
        : { choice: { element: elementName(element), type: chosen.code } }),
      ...(sliceName === undefined ? {} : { sliceName }),
      ...(element.short === undefined ? {} : { short: element.short }),
      ...(element.binding === undefined ? {} : { binding: element.binding }),
      ...(element.fixed === undefined ? {} : { fixed: element.fixed }),
      ...(element.pattern === undefined ? {} : { pattern: element.pattern }),
      ...(element.isModifier === true ? { isModifier: true as const } : {}),
      segments,
    },
  };
}

/** The child called `name`: by its name, or a choice element by one of its concrete names. */
function findChild(
  elements: readonly IndexElement[],
  name: string,
): { element: IndexElement; type?: ElementType } | undefined {
  for (const element of elements) {
    const own = elementName(element);
    if (own === name) return { element };
    if (own.endsWith("[x]")) {
      const base = own.slice(0, -3);
      if (!name.startsWith(base)) continue;
      const type = (element.type ?? []).find((t) => `${base}${typeSuffix(t.code)}` === name);
      if (type !== undefined) return { element, type };
    }
  }
  return undefined;
}

/**
 * One level of the element tree under a path (`""` for the resource itself). Choice elements give
 * one node per type; extensions and prohibited elements are left out; profile slices follow the
 * element they slice. Datatypes expand on request: ask again with the node's path.
 */
export function elementTree(defs: FhirDefinitions, ref: string, path = ""): PathResult<TreeNode[]> {
  const fail = (issue: Omit<PathIssue, "path">): PathResult<never> => ({
    ok: false,
    issue: { ...issue, path },
  });
  const resolved = resolvePath(defs, ref, path);
  if (!resolved.ok) return resolved;
  // Back to the position the path ended on: its document and element.
  const start = root(defs, ref);
  if (!start.ok) return fail(start.issue);
  const at = positionOf(defs, resolved.value, start.value);
  const children = childrenOf(defs, at);
  if (!children.ok) return fail(children.issue);
  const { doc, elements } = children.value;
  const prefix = path === "" ? "" : `${path}.`;
  const nodes: TreeNode[] = [];
  for (const element of elements) {
    const name = elementName(element);
    if (EXTENSIONS.has(name) || element.max === "0") continue;
    if (name.endsWith("[x]")) {
      const base = name.slice(0, -3);
      for (const type of element.type ?? []) {
        const concrete = `${base}${typeSuffix(type.code)}`;
        nodes.push(
          node(defs, docIndex(doc), element, concrete, `${prefix}${concrete}`, [type], {
            element: name,
            type: type.code,
          }),
        );
      }
      continue;
    }
    nodes.push(node(defs, docIndex(doc), element, name, `${prefix}${name}`, element.type ?? []));
    for (const slice of docIndex(doc).slices.get(element.id) ?? []) {
      if (slice.max === "0" || slice.sliceName === undefined) continue;
      const sliced = `${name}[${slice.sliceName}]`;
      nodes.push(
        node(
          defs,
          docIndex(doc),
          slice,
          sliced,
          `${prefix}${sliced}`,
          slice.type ?? element.type ?? [],
        ),
      );
    }
  }
  return { ok: true, value: nodes };
}

/** The position (document and element) a resolved path ends on. */
function positionOf(defs: FhirDefinitions, resolved: ResolvedElement, start: Position): Position {
  if (resolved.segments.length === 0) return start;
  const doc = defs.document(resolved.definition) ?? start.doc;
  const element = docIndex(doc).byId.get(resolved.elementId) ?? start.element;
  const chosen = resolved.choice === undefined ? undefined : resolved.types[0];
  return { doc, element, ...(chosen === undefined ? {} : { chosen }) };
}

function node(
  defs: FhirDefinitions,
  index: DocIndex,
  element: IndexElement,
  name: string,
  path: string,
  types: readonly ElementType[],
  choice?: { element: string; type: string },
): TreeNode {
  const code = types.length === 1 ? types[0]?.code : undefined;
  const inline = index.children.get(element.id);
  const expandable =
    element.contentReference !== undefined ||
    (inline !== undefined && inline.length > 0) ||
    (code !== undefined && (INLINE_TYPES.has(code) || defs.entry(code)?.kind === "complex-type"));
  return {
    name,
    path,
    elementId: element.id,
    min: element.min,
    max: element.max,
    types,
    ...(choice === undefined ? {} : { choice }),
    ...(element.sliceName === undefined ? {} : { sliceName: element.sliceName }),
    ...(element.short === undefined ? {} : { short: element.short }),
    ...(element.binding === undefined ? {} : { binding: element.binding }),
    ...(element.fixed === undefined ? {} : { fixed: element.fixed }),
    ...(element.pattern === undefined ? {} : { pattern: element.pattern }),
    ...(element.isModifier === true ? { isModifier: true as const } : {}),
    ...(element.mustSupport === true ? { mustSupport: true as const } : {}),
    expandable,
  };
}

/** The resource types and profiles a Reference element allows. */
export function referenceTargets(
  defs: FhirDefinitions,
  ref: string,
  path: string,
): PathResult<ReferenceTargets> {
  const resolved = resolvePath(defs, ref, path);
  if (!resolved.ok) return resolved;
  const references = resolved.value.types.filter((t) => REFERENCE_TYPES.has(t.code));
  if (references.length === 0)
    return {
      ok: false,
      issue: { code: "NOT_A_REFERENCE", message: `${path} is not a Reference`, path },
    };
  const targets = references.flatMap((t) => t.targetProfile ?? []);
  const any =
    targets.length === 0 ||
    targets.some(
      (url) => defs.entry(url)?.type === "Resource" || defs.entry(url)?.type === "DomainResource",
    );
  if (any)
    return {
      ok: true,
      value: { any: true, resourceTypes: defs.resourceTypes(), profiles: [], unknown: [] },
    };
  const types = new Set<string>();
  const profiles: string[] = [];
  const unknown: string[] = [];
  for (const url of targets) {
    const entry = defs.entry(url);
    if (entry?.kind !== "resource") {
      unknown.push(url);
      continue;
    }
    if (entry.derivation === "constraint") profiles.push(url);
    types.add(entry.type);
  }
  return { ok: true, value: { any: false, resourceTypes: [...types].sort(), profiles, unknown } };
}

/**
 * Runs a question, loading through `fetch` every document it reports missing
 * (`TYPE_NOT_LOADED`), until it answers. For the browser, where documents arrive on demand:
 * `withDefinitions(defs, fetch, () => resolvePath(defs, "Observation", "valueQuantity.value"))`.
 */
export async function withDefinitions<T>(
  defs: FhirDefinitions,
  fetch: IndexFetch,
  question: () => PathResult<T>,
): Promise<PathResult<T>> {
  const tried = new Set<string>();
  for (;;) {
    const answer = question();
    if (answer.ok || answer.issue.code !== "TYPE_NOT_LOADED" || answer.issue.type === undefined)
      return answer;
    const type = answer.issue.type;
    if (tried.has(type)) return answer;
    tried.add(type);
    const loaded = await defs.load([type], fetch);
    if (!loaded.ok)
      return {
        ok: false,
        issue: { ...answer.issue, message: loaded.issues.map((i) => i.message).join("; ") },
      };
  }
}
