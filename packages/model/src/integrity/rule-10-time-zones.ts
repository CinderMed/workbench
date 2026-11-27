// Rule 10: time zones (project format 1.5.0, ADR-0024). A table or column names a time zone as a
// fixed offset (`+01:00`, `Z`, which the schema checks) or an IANA zone, which must be in the
// workbench's tzdata snapshot (TIME_ZONE_UNKNOWN, error): the export writes the zone's offsets into
// the normalization specification, so it cannot write a zone it does not have. A time zone on a
// column that is not dateTime is never used (TIME_ZONE_NOT_DATETIME, warning). A dateTime column
// whose values have a time needs a zone, its own or its table's (TIME_ZONE_MISSING, error): FHIR
// requires an offset on a time, and the workbench never guesses one.
import type { ValidationResult } from "../validation-result.js";
import { columnTimeZone, isKnownTimeZone, takesTimeZone } from "../values/time-zones.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error, warning } from "./result.js";

const unknown = (zone: string): string =>
  `time zone '${zone}' is not a fixed offset (+01:00) or an IANA zone the workbench knows (e.g. Europe/Rome)`;

export function checkTimeZones(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const source of index.project.sources) {
    if (source.timeZone !== undefined && !isKnownTimeZone(source.timeZone))
      results.push(
        error(
          IntegrityCode.TIME_ZONE_UNKNOWN,
          { objectKind: "source", id: source.id },
          "timeZone",
          `table '${source.name}': ${unknown(source.timeZone)}`,
        ),
      );
    for (const column of source.columns) {
      if (takesTimeZone(column) && columnTimeZone(source, column) === undefined)
        results.push(
          error(
            IntegrityCode.TIME_ZONE_MISSING,
            { objectKind: "column", id: column.id },
            "timeZone",
            `column '${column.name}' of table '${source.name}' has date-times with a time but no time zone: declare one on the table or the column (e.g. Europe/Rome or +01:00), or a date format without a time`,
          ),
        );
      if (column.timeZone === undefined) continue;
      if (!isKnownTimeZone(column.timeZone))
        results.push(
          error(
            IntegrityCode.TIME_ZONE_UNKNOWN,
            { objectKind: "column", id: column.id },
            "timeZone",
            `column '${column.name}': ${unknown(column.timeZone)}`,
          ),
        );
      if (column.dataType !== "dateTime")
        results.push(
          warning(
            IntegrityCode.TIME_ZONE_NOT_DATETIME,
            { objectKind: "column", id: column.id },
            "timeZone",
            `column '${column.name}' is ${column.dataType}, not dateTime: its time zone is not used`,
          ),
        );
    }
  }
  return results;
}
