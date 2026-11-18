/**
 * Type compatibility (D7; specification, "Type compatibility in the grid"): a row is valid only if
 * its transform produces a value of the target element's type. The tables of the specification
 * are encoded here once; ADR-0015 records the choices the specification leaves open.
 */
import type { Column, FhirValue, MappingRow, ValueMap } from "@cindermed/model";
import type { FhirDefinitions } from "./definitions.js";
import { type ResolvedElement, elementTree } from "./element-tree.js";

export const TypeCode = {
  /** The value cannot be written to the element's type. */
  TYPE_MISMATCH: "TYPE_MISMATCH",
  /** Compatible only through a transform, which the message names. */
  TYPE_NEEDS_TRANSFORM: "TYPE_NEEDS_TRANSFORM",
  /** A copy to a complex type; the message lists the sub-elements that fit. */
  COMPLEX_TARGET: "COMPLEX_TARGET",
  /** Allowed, with a possible loss, out-of-range or badly formatted value (warning). */
  TYPE_PRECISION: "TYPE_PRECISION",
  /** An expert expression: not type-checked, only by the grammar (permanent warning). */
  EXPRESSION_NOT_TYPE_CHECKED: "EXPRESSION_NOT_TYPE_CHECKED",
} as const;
export type TypeCode = (typeof TypeCode)[keyof typeof TypeCode];

export type ColumnType = Column["dataType"];

/** How a value fits an element type. */
export type Verdict =
  | { readonly kind: "ok" }
  | { readonly kind: "warn"; readonly why: string }
  | { readonly kind: "transform"; readonly use: string }
  | { readonly kind: "complex" }
  | { readonly kind: "mismatch"; readonly why?: string };

const OK: Verdict = { kind: "ok" };
const SD = "http://hl7.org/fhir/StructureDefinition/";

/** The FHIRPath system types some core elements use, as FHIR primitive names. */
const SYSTEM_TYPES: Readonly<Record<string, string>> = {
  "http://hl7.org/fhirpath/System.String": "string",
  "http://hl7.org/fhirpath/System.Boolean": "boolean",
  "http://hl7.org/fhirpath/System.Integer": "integer",
  "http://hl7.org/fhirpath/System.Decimal": "decimal",
  "http://hl7.org/fhirpath/System.Date": "date",
  "http://hl7.org/fhirpath/System.DateTime": "dateTime",
  "http://hl7.org/fhirpath/System.Time": "time",
};

/** The FHIR type name of an element type code. */
export function fhirType(code: string): string {
  return SYSTEM_TYPES[code] ?? code;
}

/** Quantity and the types and profiles derived from it (Age, Duration, Distance, Count, SimpleQuantity). */
export function isQuantity(defs: FhirDefinitions, type: string): boolean {
  if (type === "Quantity") return true;
  const entry = defs.entry(type);
  return entry?.type === "Quantity" || entry?.baseDefinition === `${SD}Quantity`;
}

function isComplex(defs: FhirDefinitions, type: string): boolean {
  const kind = defs.entry(type)?.kind;
  return kind === "complex-type" || kind === "resource";
}

const VALUE_MAP = "a value map";
const CAST_TO_STRING = "a conversion (cast) to string";
const QUANTITY = "the quantity transform (with a unit)";

interface CopyRule {
  readonly ok: readonly string[];
  readonly warn?: Readonly<Record<string, string>>;
  /** Element types reachable through a transform, and which one. */
  readonly transform?: readonly (readonly [readonly string[] | "quantity", string])[];
  /** Why other primitive types do not fit, for the cases the specification explains. */
  readonly mismatch?: Readonly<Record<string, string>>;
}

const FORMAT = (type: string) => `the value must have the format of ${type}`;

/** Direct copy (`transform.kind = copy`): the first table of the specification. */
const COPY: Readonly<Record<ColumnType, CopyRule>> = {
  string: {
    ok: ["string", "markdown"],
    warn: Object.fromEntries(["code", "id", "uri", "url", "canonical"].map((t) => [t, FORMAT(t)])),
  },
  integer: {
    // integer64 (R5) holds every integer: not in the specification's table (ADR-0015).
    ok: ["integer", "integer64"],
    warn: {
      positiveInt: "a value below 1 gives an invalid resource",
      unsignedInt: "a negative value gives an invalid resource",
      decimal: "the integer is written as a decimal",
    },
    transform: [
      ["quantity", QUANTITY],
      [["string", "markdown"], CAST_TO_STRING],
    ],
  },
  decimal: {
    ok: ["decimal"],
    transform: [
      ["quantity", QUANTITY],
      [["string", "markdown"], CAST_TO_STRING],
    ],
    mismatch: {
      integer: "an integer would lose the decimals",
      positiveInt: "an integer would lose the decimals",
      unsignedInt: "an integer would lose the decimals",
    },
  },
  boolean: {
    ok: ["boolean"],
    transform: [
      [
        ["code", "string", "Coding", "CodeableConcept"],
        `${VALUE_MAP} (true and false to codes or text)`,
      ],
    ],
  },
  date: {
    ok: ["date", "dateTime"],
    transform: [[["string", "markdown"], CAST_TO_STRING]],
    mismatch: { instant: "an instant needs a time and a time zone" },
  },
  dateTime: {
    ok: ["dateTime"],
    transform: [[["string", "markdown"], CAST_TO_STRING]],
    mismatch: { date: "the time would be lost", instant: "an instant needs a time zone" },
  },
  categorical: {
    ok: [],
    warn: {
      code: "the column's values are written as they are: they must be valid codes (see binding)",
      string: "the column's codes are written as they are, not their labels",
    },
    transform: [[["Coding", "CodeableConcept", "boolean"], VALUE_MAP]],
  },
  multipleChoice: {
    ok: [],
    transform: [],
  },
};

/** How a copy of a column of this type fits an element type. */
export function copyVerdict(
  defs: FhirDefinitions,
  column: ColumnType,
  elementType: string,
): Verdict {
  const type = fhirType(elementType);
  if (column === "multipleChoice")
    return { kind: "transform", use: `${VALUE_MAP} with repeat eachValue` };
  const rule = COPY[column];
  if (rule.ok.includes(type)) return OK;
  const warn = rule.warn?.[type];
  if (warn !== undefined) return { kind: "warn", why: warn };
  for (const [targets, use] of rule.transform ?? []) {
    if (targets === "quantity" ? isQuantity(defs, type) : targets.includes(type))
      return { kind: "transform", use };
  }
  if (isComplex(defs, type)) return { kind: "complex" };
  const why = rule.mismatch?.[type];
  return why === undefined ? { kind: "mismatch" } : { kind: "mismatch", why };
}

/** Conversions a cast may do: to string, to the same type, integer → decimal, date → dateTime. */
export function castAllowed(column: ColumnType, to: string): boolean {
  return (
    to === "string" ||
    to === column ||
    (column === "integer" && to === "decimal") ||
    (column === "date" && to === "dateTime")
  );
}

/** How a typed value (constant, fixed value, value action) fits an element type. */
export function valueVerdict(
  defs: FhirDefinitions,
  value: FhirValue,
  elementType: string,
): Verdict {
  const type = fhirType(elementType);
  if (value.type === type) return OK;
  if (value.type === "Quantity" && isQuantity(defs, type)) return OK;
  return { kind: "mismatch" };
}

/** How the output of a value map fits an element type: the map's target must be the element's type. */
export function valueMapVerdict(valueMap: ValueMap, elementType: string): Verdict {
  return valueMap.target === fhirType(elementType) ? OK : { kind: "mismatch" };
}

// ---------------------------------------------------------------------------------------------

/** A finding of the type checks, before it becomes a validation result. */
export interface TypeFinding {
  readonly code: TypeCode;
  readonly severity: "error" | "warning";
  /** The field of the row that is wrong: `path`, `transform`, `transform.to`, `columnId`, … */
  readonly field: string;
  readonly message: string;
}

export interface RowContext {
  readonly columns: ReadonlyMap<string, Column>;
  readonly valueMaps: ReadonlyMap<string, ValueMap>;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** `Observation.valueQuantity (Quantity)`. */
function target(resourceType: string, element: ResolvedElement): string {
  return `${resourceType}.${element.path} (${element.types.map((t) => fhirType(t.code)).join(" or ")})`;
}

/** For a choice, the concrete names whose type a verdict accepts: `valueInteger or valueString`. */
function alternatives(element: ResolvedElement, accepts: (type: string) => Verdict): string {
  const choice = element.choice;
  if (choice === undefined) return "";
  const base = choice.element.slice(0, -3);
  const prefix = element.path.slice(
    0,
    element.path.length - (element.path.split(".").at(-1) ?? "").length,
  );
  const names = choice.options
    .filter((t) => t !== choice.type)
    .filter((t) => {
      const v = accepts(t).kind;
      return v === "ok" || v === "warn";
    })
    .map((t) => `${prefix}${base}${t.charAt(0).toUpperCase()}${t.slice(1)}`);
  return names.length === 0 ? "" : `; use ${names.join(" or ")}`;
}

/** The sub-elements of a complex type a column of this type can be copied to: `name.family, name.given`. */
function compatibleChildren(
  defs: FhirDefinitions,
  column: ColumnType,
  element: ResolvedElement,
  type: string,
): string[] {
  const tree = elementTree(defs, type);
  if (!tree.ok) return [];
  return tree.value
    .filter((node) => {
      const only = node.types.length === 1 ? node.types[0] : undefined;
      if (only === undefined) return false;
      const v = copyVerdict(defs, column, only.code).kind;
      return v === "ok" || v === "warn";
    })
    .map((node) => `${element.path}.${node.name}`);
}

/**
 * The verdict for an element with several types (rare outside choices): the best of them.
 * Order: ok, warn, transform, complex, mismatch.
 */
function best(
  element: ResolvedElement,
  judge: (type: string) => Verdict,
): { verdict: Verdict; type: string } {
  const rank = { ok: 0, warn: 1, transform: 2, complex: 3, mismatch: 4 } as const;
  let found: { verdict: Verdict; type: string } | undefined;
  for (const t of element.types) {
    const verdict = judge(t.code);
    if (found === undefined || rank[verdict.kind] < rank[found.verdict.kind])
      found = { verdict, type: fhirType(t.code) };
  }
  return (
    found ?? { verdict: { kind: "mismatch", why: "the element has no type" }, type: "no type" }
  );
}

/** The type findings of a mapping row whose path resolved to `element`. */
export function checkRowTypes(
  defs: FhirDefinitions,
  context: RowContext,
  row: MappingRow,
  resourceType: string,
  element: ResolvedElement,
): TypeFinding[] {
  const where = target(resourceType, element);
  const transform = row.transform;
  const column = row.columnId === undefined ? undefined : context.columns.get(row.columnId);
  const error = (code: TypeCode, field: string, message: string): TypeFinding => ({
    code,
    severity: "error",
    field,
    message: `${row.code}: ${message}`,
  });
  const warning = (code: TypeCode, field: string, message: string): TypeFinding => ({
    code,
    severity: "warning",
    field,
    message: `${row.code}: ${message}`,
  });

  /** A copy (or the output of a cast) of a value of this column type. */
  const copied = (type: ColumnType, source: string): TypeFinding[] => {
    const { verdict, type: elementType } = best(element, (t) => copyVerdict(defs, type, t));
    const others = alternatives(element, (t) => copyVerdict(defs, type, t));
    switch (verdict.kind) {
      case "ok":
        return [];
      case "warn":
        return [
          warning(
            TypeCode.TYPE_PRECISION,
            "path",
            `${source} is written to ${where}: ${verdict.why}`,
          ),
        ];
      case "transform":
        return [
          error(
            TypeCode.TYPE_NEEDS_TRANSFORM,
            "transform",
            `${source} needs ${verdict.use} to be written to ${where}${others}`,
          ),
        ];
      case "complex": {
        const children = compatibleChildren(defs, type, element, elementType);
        const fit =
          children.length === 0
            ? `no element of ${elementType} takes ${article(type)} value`
            : `use one of its elements: ${children.join(", ")}`;
        return [
          error(
            TypeCode.COMPLEX_TARGET,
            "path",
            `${source} cannot be copied to ${where}, a complex type: ${fit}${others}`,
          ),
        ];
      }
      case "mismatch":
        return [
          error(
            TypeCode.TYPE_MISMATCH,
            "path",
            `${source} cannot be written to ${where}${verdict.why === undefined ? "" : `: ${verdict.why}`}${others}`,
          ),
        ];
    }
  };

  switch (transform.kind) {
    case "copy":
      return column === undefined
        ? []
        : copied(column.dataType, `column ${column.name} (${column.dataType})`);
    case "cast": {
      if (column === undefined) return [];
      if (!castAllowed(column.dataType, transform.to))
        return [
          error(
            TypeCode.TYPE_MISMATCH,
            "transform.to",
            `column ${column.name} (${column.dataType}) cannot be converted to ${transform.to}: a conversion goes to string, to the same type, from integer to decimal or from date to dateTime`,
          ),
        ];
      return copied(transform.to, `column ${column.name} converted to ${transform.to}`);
    }
    case "valueMap": {
      const valueMap = context.valueMaps.get(transform.valueMapId);
      if (valueMap === undefined) return [];
      const { verdict } = best(element, (t) => valueMapVerdict(valueMap, t));
      if (verdict.kind === "ok") return [];
      const others = alternatives(element, (t) => valueMapVerdict(valueMap, t));
      return [
        error(
          TypeCode.TYPE_MISMATCH,
          "path",
          `value map ${valueMap.name} gives ${valueMap.target}, but the element is ${where}${others}`,
        ),
      ];
    }
    case "quantity": {
      const findings: TypeFinding[] = [];
      if (column !== undefined && column.dataType !== "integer" && column.dataType !== "decimal")
        findings.push(
          error(
            TypeCode.TYPE_MISMATCH,
            "columnId",
            `the quantity transform needs an integer or decimal column, not ${column.name} (${column.dataType})`,
          ),
        );
      const { verdict } = best(element, (t) =>
        isQuantity(defs, fhirType(t)) ? OK : { kind: "mismatch" },
      );
      if (verdict.kind !== "ok") {
        const others = alternatives(element, (t) =>
          isQuantity(defs, t) ? OK : { kind: "mismatch" },
        );
        findings.push(
          error(
            TypeCode.TYPE_MISMATCH,
            "path",
            `the quantity transform gives a Quantity, but the element is ${where}${others}`,
          ),
        );
      }
      return findings;
    }
    case "concat": {
      const findings: TypeFinding[] = [];
      transform.columnIds.forEach((id, i) => {
        const part = context.columns.get(id);
        if (
          part !== undefined &&
          !["string", "categorical", "integer", "decimal"].includes(part.dataType)
        )
          findings.push(
            error(
              TypeCode.TYPE_MISMATCH,
              `transform.columnIds.${String(i)}`,
              `a concatenation takes string, categorical, integer or decimal columns, not ${part.name} (${part.dataType})`,
            ),
          );
      });
      const { verdict } = best(element, (t) =>
        ["string", "markdown"].includes(fhirType(t)) ? OK : { kind: "mismatch" },
      );
      if (verdict.kind !== "ok")
        findings.push(
          error(
            TypeCode.TYPE_MISMATCH,
            "path",
            `a concatenation gives a string, but the element is ${where}${alternatives(element, (t) => (["string", "markdown"].includes(t) ? OK : { kind: "mismatch" }))}`,
          ),
        );
      return findings;
    }
    case "constant": {
      const { verdict } = best(element, (t) => valueVerdict(defs, transform.value, t));
      if (verdict.kind === "ok") return [];
      return [
        error(
          TypeCode.TYPE_MISMATCH,
          "transform.value",
          `the constant is ${article(transform.value.type)}, but the element is ${where}${alternatives(element, (t) => valueVerdict(defs, transform.value, t))}`,
        ),
      ];
    }
    case "reference": {
      const { verdict } = best(element, (t) =>
        t === "Reference" || t === "CodeableReference" ? OK : { kind: "mismatch" },
      );
      if (verdict.kind === "ok") return [];
      return [
        error(
          TypeCode.TYPE_MISMATCH,
          "path",
          `a reference needs a Reference element, but the element is ${where}`,
        ),
      ];
    }
    case "expression":
      return [
        warning(
          TypeCode.EXPRESSION_NOT_TYPE_CHECKED,
          "transform",
          "an expert expression is not type-checked, only by the grammar",
        ),
      ];
  }
}

/** The type finding of a typed value (fixed value, value action) written to `element`, if any. */
export function checkValueType(
  defs: FhirDefinitions,
  value: FhirValue,
  resourceType: string,
  element: ResolvedElement,
  label: string,
): TypeFinding | undefined {
  const { verdict } = best(element, (t) => valueVerdict(defs, value, t));
  if (verdict.kind === "ok") return undefined;
  return {
    code: TypeCode.TYPE_MISMATCH,
    severity: "error",
    field: "value",
    message: `${label}: the value is ${article(value.type)}, but the element is ${target(resourceType, element)}${alternatives(element, (t) => valueVerdict(defs, value, t))}`,
  };
}
