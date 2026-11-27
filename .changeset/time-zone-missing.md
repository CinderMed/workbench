---
"@cindermed/model": minor
"@cindermed/export": minor
"@cindermed/fml": minor
---

A `dateTime` column whose values have a time now needs a time zone, its own or its table's: validation reports `TIME_ZONE_MISSING` (error) otherwise. `columnTimeZone` and `takesTimeZone` move to `@cindermed/model` (`@cindermed/fml` no longer exports `columnTimeZone`). The mapping table's Columns sheet shows the time zone of a date-time column in its Format cell.
