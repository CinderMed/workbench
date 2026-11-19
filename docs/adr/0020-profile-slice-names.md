# ADR-0020: Profile slice names in element paths

- Status: accepted
- Date: 2026-11-19
- Module: 3 (FHIR definitions and validation)

## Context

`ElementPath` and `Slice.name` allowed slice names matching `[a-z][A-Za-z0-9-]*`. Profile slices that start with an upper-case letter resolve in `@cindermed/fhir-defs` (ADR-0014), but a project could not name them. Examples are `VSCat` in the R4/R5 vital signs profile and `SystolicBP` / `DiastolicBP` in the blood pressure profile. Issue #150 decided the new pattern, as part of project format 1.4.0 while it is unreleased.

## Decision

- **Contract (project format 1.4.0).** Slice names in `ElementPath` and in `Slice.name` match `[A-Za-z][A-Za-z0-9-]*`. `_`, `/`, `@` and brackets stay out: they would break the `component[name]` syntax, and the generator's rule names (`slice-<name>`, `slice-<name>-<path>`) must stay valid FML rule names. The pattern only widens, so a 1.3.0 project reads as 1.4.0 unchanged; the migration tests cover a project with named slices.
- **The generator** writes such slices like any other named slice (`slice-VSCat`, `slice-VSCat-code`). A unit case checks the rule names and the FML grammar.
- **`SLICE_NAME_UNUSABLE` (warning, D7).** A slice whose name has other characters still resolves, but no path can name it. A warning is given when a role's profile requires such a slice (`min` ≥ 1) on a top-level element. The resource may then not conform to the profile. The warning is on the role (`field: profile`).

## Consequences

- Only required slices of top-level elements are checked. Optional slices with unusable names are only missing from what a project can write, and nested slices (inside a datatype or a backbone element) are not walked. The path picker (D3/D4, module 7) can use `usableSliceName` to show such slices as not selectable.
- A wider pattern (for example `_`) would need a new rule-name scheme and a new minor of the project format.
