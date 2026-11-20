/**
 * Named slices of a role (D4): a repetition of a repeating element (`component`, `category`)
 * identified by a name (`component[nrs]`) and by the fixed values that tell it apart (its
 * discriminator, such as `component.code`). Pure: the picker and the role editor build and remove
 * slices with these, and write the role through the store.
 */
import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance, ProjectFile } from "@cindermed/model";
import { type ValueError, type ValueKind, buildValue, kindOfType } from "../values/fhir-value";

export type { ValueKind } from "../values/fhir-value";

type Slice = NonNullable<Instance["slices"]>[number];

/** Slice names a project path can hold (project format 1.4.0, ADR-0020). */
const NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Whether an element repeats (`max` above 1), so it can hold named slices. */
export const repeats = (node: Pick<TreeNode, "max">) => node.max === "*" || Number(node.max) > 1;

/** The slices a role declares on a path, in the role's order. */
export function slicesOn(role: Instance, path: string): Slice[] {
  return (role.slices ?? []).filter((s) => s.path === path);
}

/** The path segment of a slice: `component[nrs]`. */
export const slicePath = (slice: Pick<Slice, "path" | "name">) => `${slice.path}[${slice.name}]`;

/** How a value of this element is entered, or undefined when the element cannot discriminate. */
export function valueKind(node: TreeNode): ValueKind | undefined {
  if (node.types.length !== 1) return undefined;
  return kindOfType(node.types[0]?.code ?? "");
}

/** The children of a repeating element that can tell its slices apart; `code` first when it can. */
export function discriminatorChoices(children: readonly TreeNode[]): TreeNode[] {
  const usable = children.filter((c) => valueKind(c) !== undefined && c.sliceName === undefined);
  return [...usable.filter((c) => c.name === "code"), ...usable.filter((c) => c.name !== "code")];
}

/** What the slice form holds. */
export interface SliceDraft {
  readonly name: string;
  /** The discriminator element, relative to the repeating element (`code`). */
  readonly discriminatorPath: string;
  readonly system: string;
  readonly code: string;
  readonly display: string;
  /** The value of a primitive discriminator, as typed. */
  readonly value: string;
}

export type SliceError =
  "nameRequired" | "nameInvalid" | "nameTaken" | "discriminatorRequired" | ValueError;

/**
 * The slice the form describes, or the first thing wrong with it. A coding entered here is
 * `manual` (typed by hand, not checked by a terminology server). `taken` are the names already
 * used on the same element of the role.
 */
export function buildSlice(
  id: string,
  path: string,
  kind: ValueKind | undefined,
  draft: SliceDraft,
  taken: readonly string[],
): { readonly slice: Slice } | { readonly error: SliceError } {
  const name = draft.name.trim();
  if (name === "") return { error: "nameRequired" };
  if (!NAME.test(name)) return { error: "nameInvalid" };
  if (taken.includes(name)) return { error: "nameTaken" };
  if (draft.discriminatorPath === "" || kind === undefined)
    return { error: "discriminatorRequired" };
  const built = buildValue(kind, draft);
  if ("error" in built) return built;
  const { value } = built;
  return {
    slice: { id, path, name, discriminator: [{ path: draft.discriminatorPath, value }] },
  };
}

/** The role with a slice added after the others. */
export function withSlice(role: Instance, slice: Slice): Instance {
  return { ...role, slices: [...(role.slices ?? []), slice] };
}

/** The role without a slice; `slices` is left out when none remain. */
export function withoutSlice(role: Instance, sliceId: string): Instance {
  const { slices, ...rest } = role;
  const kept = (slices ?? []).filter((s) => s.id !== sliceId);
  return kept.length === 0 ? rest : { ...rest, slices: kept };
}

/** The mapping rows of a role whose path goes through a slice. */
export function rowsUsingSlice(project: ProjectFile, roleId: string, slice: Slice): number {
  const segment = slicePath(slice);
  return project.mappings.filter(
    (m) => m.instanceId === roleId && (m.path === segment || m.path.startsWith(`${segment}.`)),
  ).length;
}

/** The discriminator as text, for display: `code = http://snomed.info/sct|1284852002`. */
export function describeDiscriminator(slice: Slice): string {
  return slice.discriminator
    .map(({ path, value }) => {
      const text =
        "coding" in value
          ? `${value.coding.system}|${value.coding.code}`
          : "unit" in value
            ? `${String(value.value ?? "")} ${value.unit.code}`
            : String(value.value);
      return `${path} = ${text}`;
    })
    .join(", ");
}
