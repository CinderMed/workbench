// Rule 10: time zones (project format 1.5.0, ADR-0024). A table or column names a time zone as a
// fixed offset (`+01:00`, `Z`, which the schema checks) or an IANA zone, which must be in the
// workbench's tzdata snapshot (TIME_ZONE_UNKNOWN, error): the export writes the zone's offsets into
// the normalization specification, so it cannot write a zone it does not have. A time zone on a
// column that is not dateTime is never used (TIME_ZONE_NOT_DATETIME, warning).
import type { ValidationResult } from "../validation-result.js";
import { isKnownTimeZone } from "../values/time-zones.js";
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
