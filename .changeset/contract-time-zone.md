---
"@cindermed/model": minor
"@cindermed/normalizer": minor
"@cindermed/fml": minor
"@cindermed/export": minor
---

Time zones at the border (#107, ADR-0024). Project format 1.5.0 adds an optional `timeZone` on a table and on a column: a fixed offset (`+01:00`, `Z`) or an IANA zone (`Europe/Rome`). Normalization 1.3.0 writes a dateTime with a time with its offset (`2025-01-15T10:00:00+01:00`). An IANA zone's offsets come from the zone's rules in the specification's new `timeZones`, which the export copies from a committed tzdata snapshot (2026e, 1970–2299), so every implementation gives the same result without a time-zone library. A local time in the spring-forward gap is an invalid value; one in the repeated fall-back hour takes the earlier offset. Integrity rule 10 reports a zone the snapshot does not have (`TIME_ZONE_UNKNOWN`, error) and a zone on a column that is not dateTime (`TIME_ZONE_NOT_DATETIME`, warning). Projects without a zone convert as before.
