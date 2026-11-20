/**
 * Named slices of a role (D4): a repetition of a repeating element (`component`, `category`)
 * identified by a name (`component[nrs]`) and by the fixed values that tell it apart (its
 * discriminator, such as `component.code`). Pure: the picker and the role editor build and remove
 * slices with these, and write the role through the store.
 */
import type { TreeNode } from "@cindermed/fhir-defs";
import type { Instance, ProjectFile } from "@cindermed/model";

type Slice = NonNullable<Instance["slices"]>[number];
type FhirValue = Slice["discriminator"][number]["value"];

/** Slice names a project path can hold (project format 1.4.0, ADR-0020). */
const NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/** The primitive types a discriminator value can have (`FhirValue` in the project schema). */
const PRIMITIVES = [
  "string",
  "code",
  "boolean",
  "integer",
  "decimal",
  "date",
  "dateTime",
  "uri",
] as const;
type Primitive = (typeof PRIMITIVES)[number];

/** How a discriminator value is entered: a coding, or a primitive of a given type. */
export type ValueKind =
  | { readonly kind: "coding"; readonly type: "Coding" | "CodeableConcept" }
  | { readonly kind: "primitive"; readonly type: Primitive };

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
  const code = node.types[0]?.code ?? "";
  if (code === "Coding" || code === "CodeableConcept") return { kind: "coding", type: code };
  const primitive = PRIMITIVES.find((p) => p === code);
  return primitive === undefined ? undefined : { kind: "primitive", type: primitive };
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
  | "nameRequired"
  | "nameInvalid"
  | "nameTaken"
  | "discriminatorRequired"
  | "systemRequired"
  | "codeRequired"
  | "valueRequired"
  | "valueInvalid";

const DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const DATE_TIME =
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]((0\d|1[0-3]):[0-5]\d|14:00)))?)?)?$/;

/** The typed value of a primitive, or undefined when the text is not one (strict, no guessing). */
function primitiveValue(type: Primitive, text: string): string | number | boolean | undefined {
  switch (type) {
    case "boolean":
      return text === "true" ? true : text === "false" ? false : undefined;
    case "integer":
      return /^-?\d+$/.test(text) ? Number(text) : undefined;
    case "decimal":
      return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
    case "date":
      return DATE.test(text) ? text : undefined;
    case "dateTime":
      return DATE_TIME.test(text) ? text : undefined;
    default:
      return text;
  }
}

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
  let value: FhirValue;
  if (kind.kind === "coding") {
    const system = draft.system.trim();
    const code = draft.code.trim();
    const display = draft.display.trim();
    if (system === "") return { error: "systemRequired" };
    if (code === "") return { error: "codeRequired" };
    value = {
      type: kind.type,
      coding: {
        system,
        code,
        ...(display === "" ? {} : { display }),
        verification: { status: "manual" },
      },
    };
  } else {
    const text = draft.value.trim();
    if (text === "") return { error: "valueRequired" };
    const typed = primitiveValue(kind.type, text);
    if (typed === undefined) return { error: "valueInvalid" };
    value = { type: kind.type, value: typed };
  }
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
