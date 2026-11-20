/**
 * Guided transforms (D5): the transforms a row can take, the form that edits one, and the
 * transform it builds. A row that reads a column takes a copy, a conversion, a value map, a
 * quantity, a coding or a concatenation; a row without a column takes a constant. References
 * (F1–F3) are module 6 and expert expressions (D6) are V2: the editor shows them, never builds
 * them. Strict: a field that is missing or not valid is refused with the reason, never guessed.
 */
import { castAllowed } from "@cindermed/fhir-defs";
import type { Column, FhirValue, MappingRow, ProjectFile, Transform } from "@cindermed/model";
import {
  type ValueDraft,
  type ValueError,
  EMPTY_VALUE,
  buildValue,
  draftOfValue,
  kindOfType,
} from "../values/fhir-value";

/** The UCUM code system: the units of a fixed-unit quantity. */
export const UCUM = "http://unitsofmeasure.org";

export type TransformKind = Transform["kind"];
/** The transforms the editor builds. */
export type EditableKind = Exclude<TransformKind, "reference" | "expression">;

/** The conversions of `cast`, in the schema's order. */
export const CAST_TYPES = ["string", "integer", "decimal", "boolean", "date", "dateTime"] as const;
type CastType = (typeof CAST_TYPES)[number];

/** The value types a constant can have (`FhirValue`, without Quantity). */
export const CONSTANT_TYPES = [
  "string",
  "code",
  "boolean",
  "integer",
  "decimal",
  "date",
  "dateTime",
  "uri",
  "Coding",
  "CodeableConcept",
] as const;

/** The transforms a row can take: by column, or a constant without one. */
export function kindsFor(column: Column | undefined): readonly EditableKind[] {
  return column === undefined
    ? ["constant"]
    : ["copy", "cast", "valueMap", "quantity", "coding", "concat"];
}

/** The conversions a column can take (specification, "Transforms and the types they produce"). */
export function castTypes(column: Column | undefined): readonly CastType[] {
  return column === undefined ? [] : CAST_TYPES.filter((to) => castAllowed(column.dataType, to));
}

export interface TransformDraft {
  readonly kind: EditableKind;
  readonly castTo: string;
  readonly inputFormat: string;
  readonly valueMapId: string;
  readonly unitMode: "fixed" | "column";
  readonly unitCode: string;
  readonly unitDisplay: string;
  readonly unitColumnId: string;
  readonly unitValueMapId: string;
  readonly system: string;
  readonly as: "Coding" | "CodeableConcept";
  readonly displayColumnId: string;
  readonly columnIds: readonly string[];
  readonly separator: string;
  readonly valueType: string;
  readonly value: ValueDraft;
  /** `repeat: eachValue`: one repetition of the element per selected value. */
  readonly repeat: boolean;
}

/** The form for a row: its transform's fields, and defaults for the other kinds. */
export function draftOf(row: MappingRow, column: Column | undefined): TransformDraft {
  const t = row.transform;
  const kinds = kindsFor(column);
  const kind: EditableKind = kinds.find((k) => k === t.kind) ?? kinds[0] ?? "copy";
  const date = column?.dataType === "date" || column?.dataType === "dateTime";
  return {
    kind,
    castTo: t.kind === "cast" ? t.to : (castTypes(column)[0] ?? ""),
    inputFormat: t.kind === "cast" ? (t.inputFormat ?? "") : date ? (column.dateFormat ?? "") : "",
    valueMapId: t.kind === "valueMap" ? t.valueMapId : "",
    unitMode: t.kind === "quantity" && t.unit === undefined ? "column" : "fixed",
    unitCode: t.kind === "quantity" ? (t.unit?.code ?? "") : (column?.unit?.code ?? ""),
    unitDisplay: t.kind === "quantity" ? (t.unit?.display ?? "") : (column?.unit?.display ?? ""),
    unitColumnId: t.kind === "quantity" ? (t.unitColumnId ?? "") : "",
    unitValueMapId: t.kind === "quantity" ? (t.unitValueMapId ?? "") : "",
    system: t.kind === "coding" ? t.system : "",
    as: t.kind === "coding" ? t.as : "CodeableConcept",
    displayColumnId: t.kind === "coding" ? (t.displayColumnId ?? "") : "",
    columnIds: t.kind === "concat" ? t.columnIds : column === undefined ? [] : [column.id],
    separator: t.kind === "concat" ? (t.separator ?? " ") : " ",
    valueType: t.kind === "constant" ? t.value.type : "string",
    value: t.kind === "constant" ? draftOfValue(t.value) : EMPTY_VALUE,
    repeat: row.repeat?.kind === "eachValue",
  };
}

export type TransformError =
  | "castToRequired"
  | "castNotAllowed"
  | "valueMapRequired"
  | "unitRequired"
  | "unitColumnRequired"
  | "unitValueMapRequired"
  | "systemRequired"
  | "concatTooFew"
  | "constantTypeRequired"
  | "repeatNeedsMultipleChoice"
  | ValueError;

type Built = { readonly transform: Transform } | { readonly error: TransformError };

/** A coding typed again as it was keeps its verification; a changed one is `manual`. */
function keepVerification(built: FhirValue, before: FhirValue | undefined): FhirValue {
  if (before === undefined || !("coding" in before) || !("coding" in built)) return built;
  const same =
    before.type === built.type &&
    before.coding.system === built.coding.system &&
    before.coding.code === built.coding.code &&
    (before.coding.display ?? "") === (built.coding.display ?? "");
  return same ? before : built;
}

function transformOf(draft: TransformDraft, row: MappingRow, column: Column | undefined): Built {
  const before = row.transform;
  switch (draft.kind) {
    case "copy":
      return { transform: { kind: "copy" } };
    case "cast": {
      const to = CAST_TYPES.find((c) => c === draft.castTo);
      if (to === undefined) return { error: "castToRequired" };
      if (!castTypes(column).includes(to)) return { error: "castNotAllowed" };
      const inputFormat = draft.inputFormat.trim();
      return { transform: { kind: "cast", to, ...(inputFormat === "" ? {} : { inputFormat }) } };
    }
    case "valueMap":
      return draft.valueMapId === ""
        ? { error: "valueMapRequired" }
        : { transform: { kind: "valueMap", valueMapId: draft.valueMapId } };
    case "quantity": {
      if (draft.unitMode === "column") {
        if (draft.unitColumnId === "") return { error: "unitColumnRequired" };
        if (draft.unitValueMapId === "") return { error: "unitValueMapRequired" };
        return {
          transform: {
            kind: "quantity",
            unitColumnId: draft.unitColumnId,
            unitValueMapId: draft.unitValueMapId,
          },
        };
      }
      const code = draft.unitCode.trim();
      const display = draft.unitDisplay.trim();
      if (code === "") return { error: "unitRequired" };
      const unit = { system: UCUM, code, ...(display === "" ? {} : { display }) };
      // A unit typed again as it was keeps its other fields (a verification).
      const kept =
        before.kind === "quantity" &&
        before.unit?.system === UCUM &&
        before.unit.code === code &&
        (before.unit.display ?? "") === display
          ? before.unit
          : unit;
      return { transform: { kind: "quantity", unit: kept } };
    }
    case "coding": {
      const system = draft.system.trim();
      if (system === "") return { error: "systemRequired" };
      return {
        transform: {
          kind: "coding",
          system,
          as: draft.as,
          ...(draft.displayColumnId === "" ? {} : { displayColumnId: draft.displayColumnId }),
        },
      };
    }
    case "concat": {
      const [first, second, ...rest] = draft.columnIds;
      if (first === undefined || second === undefined) return { error: "concatTooFew" };
      return {
        transform: {
          kind: "concat",
          columnIds: [first, second, ...rest],
          ...(draft.separator === " " ? {} : { separator: draft.separator }),
        },
      };
    }
    case "constant": {
      const kind = kindOfType(draft.valueType);
      if (kind === undefined) return { error: "constantTypeRequired" };
      const built = buildValue(kind, draft.value);
      if ("error" in built) return built;
      const previous = before.kind === "constant" ? before.value : undefined;
      return { transform: { kind: "constant", value: keepVerification(built.value, previous) } };
    }
  }
}

/** The row with the transform and repeat the form describes, or the first thing wrong. */
export function buildRow(
  draft: TransformDraft,
  row: MappingRow,
  column: Column | undefined,
): { readonly row: MappingRow } | { readonly error: TransformError } {
  if (draft.repeat && column?.dataType !== "multipleChoice")
    return { error: "repeatNeedsMultipleChoice" };
  const built = transformOf(draft, row, column);
  if ("error" in built) return built;
  const next: MappingRow = { ...row, transform: built.transform };
  if (draft.repeat) next.repeat = { kind: "eachValue" };
  else delete next.repeat;
  return { row: next };
}

/** The columns of a row's table, for the auxiliary choices (unit, display, concatenation). */
export function tableColumns(project: ProjectFile, column: Column | undefined): readonly Column[] {
  if (column === undefined) return [];
  return project.sources.find((s) => s.columns.some((c) => c.id === column.id))?.columns ?? [];
}
