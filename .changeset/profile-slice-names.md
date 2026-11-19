---
"@cindermed/model": minor
"@cindermed/fhir-defs": minor
"@cindermed/cli": minor
---

Profile slice names in element paths (#150, ADR-0020): slice names in `ElementPath` and `Slice.name` may start with an upper-case letter (`[A-Za-z][A-Za-z0-9-]*`, project format 1.4.0), so profile slices such as `category[VSCat]` can be written. `SLICE_NAME_UNUSABLE` (warning) reports a required profile slice whose name a project path cannot hold.
