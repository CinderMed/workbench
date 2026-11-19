# ADR-0017: Reference checks (F4)

- Status: accepted
- Date: 2026-11-19
- Module: 3 (FHIR definitions and validation)

## Context

F4 asks for warnings about a missing required Reference, a target of a type that is not allowed, and an orphan role. Integrity rule 5 has a FHIR half (ADR-0005): the target role's type must be allowed by the element's `targetProfile`, and a reference towards a `perValue` role needs a repeating source element. The specification names the code `REF_TARGET_NOT_ALLOWED`, and its validation table puts "type allowed for References" at the FHIR level as an error. The two warnings had no codes. The user approved `REFERENCE_REQUIRED_MISSING` and `ROLE_ORPHAN` on 2026-11-19.

## Decision

`checkReferences` in `@cindermed/fhir-defs` (`references.ts`), run by `validateFhir`:

| Code                         | Severity | When                                                                                                                                                                                                  | On                                    |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `REF_TARGET_NOT_ALLOWED`     | error    | A reference row's target role has a resource type the element's `targetProfile` does not list (`referenceTargets`, ADR-0014). An element without target profiles, or with `Resource`, allows any type | the row, `transform.targetInstanceId` |
| `REF_TARGET_NOT_ALLOWED`     | warning  | The element lists only target profiles that are not in the definitions (an IG not loaded): "target not checked"                                                                                       | the row, `transform.targetInstanceId` |
| `REFERENCE_REQUIRED_MISSING` | warning  | A role's resource (or profile) has a top-level Reference element with `min` ≥ 1, not a choice, that no row and no fixed value of the role writes                                                      | the role, `resourceType`              |
| `ROLE_ORPHAN`                | warning  | The project has two or more roles, and this role references no other role and no other role references it (reference rows only)                                                                       | the role                              |

- The check is on the type only. Whether the target role conforms to a target **profile** is not checked; that needs profile validation.
- Paths that are not references, or that do not resolve, are left to the path and type checks (D7).
- **`perValue` towards a repeating source** (rule 5) is not checked. The generator refuses `perValue` roles (no golden case yet), so such a project cannot be exported anyway. The check comes with `perValue` support.

## Consequences

- A missing required reference is a warning, as F4 says, but the exported resource would be invalid. The golden Bundle validation catches it in the examples.
- An example may need a role that nothing references (type-combinations' Location, which only hosts decimal elements). It then carries an expected `ROLE_ORPHAN` warning.
