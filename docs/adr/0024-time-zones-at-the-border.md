# ADR-0024: Time zones declared at the border, with a committed tzdata snapshot

- Status: accepted
- Date: 2026-11-27
- Module: 3b (long tables and publishing)
- Issue: #107

## Context

A FHIR `dateTime` with a time must carry an offset. Source data usually has none: MIMIC-IV's `charttime` (`2113-08-04 18:46:00`), or Italian data with `dd/MM/yyyy HH:mm`. Until normalization 1.2.0 the normalization wrote `YYYY-MM-DDThh:mm:ss` with no offset, so a copied time gave a resource that is not valid FHIR.

#105 decided that the zone is declared at the border, per table or per column, as a fixed offset or an IANA zone. Converting with an IANA zone needs its rules (the tzdata). The conversion must stay byte-identical across implementations and machines, and the domain packages do no I/O.

The choices below were made with the user on 2026-11-27.

## Decision

- **Project format 1.5.0.** An optional `timeZone` on a table, and on a column over its table's: a fixed offset (`+01:00`, `Z`) or an IANA zone name (`Europe/Rome`). Only `dateTime` columns whose format has a time (`HH`, or no format, whose default has a time) use it.
- **Normalization 1.3.0.** A column's `timeZone` is a fixed offset, written as it is (`Z` as `+00:00`), or a zone named in the specification's `timeZones`. That object holds each zone's offset on 1970-01-01, then each change as (instant, new offset) in seconds, and the tzdata version. A normalizer only looks up offsets in this table, so it needs no time-zone library.
- **Daylight saving.**
  - A local time that does not exist (the spring-forward gap, `2025-03-30 02:30` in Rome) is an **invalid value**, so `onInvalidValue` applies. Shifting it would write a time that is not in the data.
  - A local time that occurs twice (the fall-back hour, `2025-10-26 02:30`) takes the **earlier offset**, its first occurrence (`+02:00`), as RFC 5545 and `java.time` do.
  - An offset that is not a whole number of minutes (Liberia until 1972) is invalid: FHIR offsets are `±hh:mm`.
- **The tzdata snapshot is committed.**
  - `tooling/time-zones/build-zones.mjs` writes every zone Node's ICU knows, plus `UTC`, from 1970-01-01 to 2300-01-01: `packages/export/src/time-zones/zones.json` (offsets, about 1.4 MB, used by the export only) and `packages/model/src/values/time-zone-names.json` (names only, for validation in the browser too).
  - It changes only in a dedicated PR, when we choose to update tzdata.
  - The export copies the zones a table uses into its normalization specification.
  - A time outside 1970–2299 with an IANA zone is an invalid value. MIMIC-IV's shifted years (2100–2200) fall inside, and MIMIC-IV on FHIR writes them with New York's rules (`-04:00` in August, `-05:00` in January).
- **The tzdata version is in the normalization specification,** next to the rules it describes, not in the manifest. The manifest records the specification's digest, so the package still pins it, and the manifest format does not change.
- **Validation (integrity rule 10):**
  - a zone outside the snapshot is an error (`TIME_ZONE_UNKNOWN`), because the export could not write its rules;
  - a zone on a column that is not `dateTime` is a warning (`TIME_ZONE_NOT_DATETIME`).
  - a dateTime column whose values have a time (its `dateFormat` has `HH`, or it has none) and no zone, on the column or its table, is an error (`TIME_ZONE_MISSING`): FHIR requires the offset, and the workbench never guesses one. A dateTime column with a date-only format needs no zone.

## Alternatives considered

- **The export computes the rules from the Node runtime.** There is no file to commit, but the result depends on each machine's Node and its tzdata, so two exports of the same project could differ, and the golden cases would break on a Node update.
- **The normalizers call `Intl` at conversion time.** This is the simplest, but each runtime's tzdata decides the offsets, so the conversion is no longer byte-identical.
- **A third-party tz package.** It brings a new dependency into a domain package, for data the snapshot already gives.
- **Fixed offsets only.** It has no daylight saving, and it cannot reproduce MIMIC-IV on FHIR's offsets.

## Consequences

- A project with times now declares their zone. Its normalized times and Bundles gain offsets, and ids computed over those values change. The fixtures follow in a dedicated PR.
- Updating tzdata means re-running `build-zones.mjs` (about 9 minutes) and committing the result in its own PR. The diff is one line per changed zone.
- Both normalizers implement the lookup independently (`withTimeZone` in `@cindermed/model`, and `tools/normalize.mjs`). The differential test covers both daylight-saving changes, the range and non-minute offsets.
