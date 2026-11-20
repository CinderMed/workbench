/**
 * Typed FHIR values typed by hand (`FhirValue` in the project schema): a slice's discriminator
 * (D4) and a constant (D5). Strict: a text that is not a value of its type is refused, never
 * guessed. A coding typed here is `manual`: entered by hand, not checked by a terminology server.
 */
import type { FhirValue } from "@cindermed/model";

/** The primitive types of `FhirValue`. */
export const PRIMITIVES = [
  "string",
  "code",
  "boolean",
  "integer",
  "decimal",
  "date",
  "dateTime",
  "uri",
] as const;
export type Primitive = (typeof PRIMITIVES)[number];

/** How a value is entered: a coding, or a primitive of a given type. */
export type ValueKind =
  | { readonly kind: "coding"; readonly type: "Coding" | "CodeableConcept" }
  | { readonly kind: "primitive"; readonly type: Primitive };

/** The value kind of a FHIR type name, or undefined when a value of it cannot be typed here. */
export function kindOfType(type: string): ValueKind | undefined {
  if (type === "Coding" || type === "CodeableConcept") return { kind: "coding", type };
  const primitive = PRIMITIVES.find((p) => p === type);
  return primitive === undefined ? undefined : { kind: "primitive", type: primitive };
}

/** What the value fields hold, as typed. */
export interface ValueDraft {
  readonly system: string;
  readonly code: string;
  readonly display: string;
  /** The value of a primitive. */
  readonly value: string;
}

export const EMPTY_VALUE: ValueDraft = { system: "", code: "", display: "", value: "" };

export type ValueError = "systemRequired" | "codeRequired" | "valueRequired" | "valueInvalid";

const DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const DATE_TIME =
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]((0\d|1[0-3]):[0-5]\d|14:00)))?)?)?$/;

/** The typed value of a primitive, or undefined when the text is not one. */
export function primitiveValue(
  type: Primitive,
  text: string,
): string | number | boolean | undefined {
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

/** The value the fields describe, or the first thing wrong with them. */
export function buildValue(
  kind: ValueKind,
  draft: ValueDraft,
): { readonly value: FhirValue } | { readonly error: ValueError } {
  if (kind.kind === "coding") {
    const system = draft.system.trim();
    const code = draft.code.trim();
    const display = draft.display.trim();
    if (system === "") return { error: "systemRequired" };
    if (code === "") return { error: "codeRequired" };
    return {
      value: {
        type: kind.type,
        coding: {
          system,
          code,
          ...(display === "" ? {} : { display }),
          verification: { status: "manual" },
        },
      },
    };
  }
  const text = draft.value.trim();
  if (text === "") return { error: "valueRequired" };
  const typed = primitiveValue(kind.type, text);
  if (typed === undefined) return { error: "valueInvalid" };
  return { value: { type: kind.type, value: typed } };
}

/** The fields of a value already in the project, to edit it. */
export function draftOfValue(value: FhirValue | undefined): ValueDraft {
  if (value === undefined) return EMPTY_VALUE;
  if ("coding" in value)
    return {
      ...EMPTY_VALUE,
      system: value.coding.system,
      code: value.coding.code,
      display: value.coding.display ?? "",
    };
  if ("unit" in value) return EMPTY_VALUE;
  return { ...EMPTY_VALUE, value: String(value.value) };
}

const VALUE_ERRORS: readonly string[] = [
  "systemRequired",
  "codeRequired",
  "valueRequired",
  "valueInvalid",
];

/** The i18n key of an error: a value's errors are shared (`values.error.*`), others under `prefix`. */
export function errorKey(error: string, prefix: string): string {
  return VALUE_ERRORS.includes(error) ? `values.error.${error}` : `${prefix}.${error}`;
}
