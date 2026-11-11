// Rule 9: the allowed values of a column fit its declared type (project format 1.3.0, ADR-0005).
// A value the conversion could not convert would stop it (onInvalidValue: fail) or be lost, so the
// mismatch is caught on the dictionary, before export. The check uses the same parsers as the
// normalization: boolean only in the canonical forms, decimal with the column's decimalSeparator,
// integer, date/dateTime according to dateFormat with a calendar check. Values listed in
// missingValues, and values that are empty after trimming, are treated as missing and skipped.
//
// A categorical or multiple-choice column with a list must keep at least one value once missing
// values are removed (ALLOWED_VALUES_EMPTY): the normalization (1.2.0) would reject every value of
// an empty list, so it never reaches the normalization specification.
import type { Column } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import {
  canonicalText,
  parseBoolean,
  parseDate,
  parseDateTime,
  parseDecimal,
  parseInteger,
} from "../values/index.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

/** Why a value does not fit the column, or `undefined` when it fits (or the type is not checked). */
function mismatch(column: Column, value: string): string | undefined {
  switch (column.dataType) {
    case "boolean":
      return parseBoolean(value) === undefined
        ? "is not a canonical boolean (true/false, 1/0, yes/no, y/n). For words such as Sì/No, make the column categorical and map its values to boolean with a value map"
        : undefined;
    case "integer":
      return parseInteger(value) === undefined ? "is not an integer" : undefined;
    case "decimal": {
      const separator = column.decimalSeparator ?? ".";
      return parseDecimal(value, separator) === undefined
        ? `is not a decimal with the separator '${separator}'`
        : undefined;
    }
    case "date":
      return parseDate(value, column.dateFormat) === undefined
        ? `is not a valid date in the format '${column.dateFormat ?? "yyyy-MM-dd"}'`
        : undefined;
    case "dateTime":
      return parseDateTime(value, column.dateFormat) === undefined
        ? `is not a valid date and time in the format '${column.dateFormat ?? "yyyy-MM-ddTHH:mm:ss"}'`
        : undefined;
    case "string":
    case "categorical":
    case "multipleChoice":
      return undefined;
  }
}

export function checkAllowedValues(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const source of index.project.sources) {
    for (const column of source.columns) {
      const missing = new Set((column.missingValues ?? []).map(canonicalText));
      const listed = column.dataType === "categorical" || column.dataType === "multipleChoice";
      const left = (column.allowedValues ?? [])
        .map((allowed) => canonicalText(allowed.code))
        .filter((value) => value !== "" && !missing.has(value));
      if (listed && column.allowedValues !== undefined && left.length === 0) {
        results.push(
          error(
            IntegrityCode.ALLOWED_VALUES_EMPTY,
            { objectKind: "column", id: column.id },
            "allowedValues",
            `column '${column.name}' has no allowed values left once missing values are removed: the conversion would reject every value`,
          ),
        );
      }
      (column.allowedValues ?? []).forEach((allowed, i) => {
        const value = canonicalText(allowed.code);
        if (value === "" || missing.has(value)) return;
        const reason = mismatch(column, value);
        if (reason === undefined) return;
        results.push(
          error(
            IntegrityCode.ALLOWED_VALUE_TYPE_MISMATCH,
            { objectKind: "column", id: column.id },
            `allowedValues.${String(i)}.code`,
            `allowed value '${allowed.code}' of column '${column.name}' (${column.dataType}) ${reason}`,
          ),
        );
      });
    }
  }
  return results;
}
