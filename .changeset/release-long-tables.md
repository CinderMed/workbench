---
"@cindermed/api": minor
"@cindermed/web": minor
---

Module 3b (long tables and the publishing groundwork): the generator writes choice elements with their chosen type (#156), the concatenation transform (#98), a quantity's unit taken as text from a column (#108) and quantities on a nested element such as `referenceRange.low` (#125). Time zones are declared at the border (#107): a table or column names a fixed offset or an IANA zone, daylight saving is applied from a tzdata snapshot copied into each normalization specification, and a date-time with a time and no zone is an error (`TIME_ZONE_MISSING`). The export manifest pins every FHIR package by the SHA-256 of its tarball (#146). An R5 golden case (#78) and the MIMIC-IV demo slice join the golden suite; the slice matches the MIMIC-IV on FHIR demo on its key fields, with the accepted differences listed and checked (#198).

Formats: project 1.5.0, normalization 1.3.0, manifest 1.1.0; older files are read as they are.

**Not published to npm:** publishing is deferred after the MVP (#216). Every pull request packs the core packages and the CLI and checks the tarballs; use them from the repository as before (`pnpm -r build`, `pnpm cindermed …`).

Known limitations:

- #204: a value-map condition on a value with an apostrophe (`Crohn's`) is read wrongly by the HL7 engine, which drops FHIRPath escapes; avoid such source values in value maps for now.
- The grid edits neither `dateFormat` nor `timeZone`: a `TIME_ZONE_MISSING` error is fixed in the project file until the column dictionary (B4, module 5).
- R5 projects do not load `hl7.terminology.r5` by default: bindings to its value sets are checked only when the project lists the package in `project.packages`.
- #194: a cell with `TYPE_NEEDS_TRANSFORM` names the transform to use, but it is still set by hand.
- The grid still runs only in the local mode, with no login, until module 4; the Docker images do not contain it.
