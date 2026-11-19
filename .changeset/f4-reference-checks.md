---
"@cindermed/fhir-defs": minor
"@cindermed/cli": minor
---

Reference checks (F4, ADR-0017): `REF_TARGET_NOT_ALLOWED` (error) when a reference points to a role whose type the element's target profiles do not allow (a warning, "target not checked", when those profiles are not in the definitions); `REFERENCE_REQUIRED_MISSING` (warning) when a required top-level Reference of a role is not written; `ROLE_ORPHAN` (warning) when, with two or more roles, a role is linked to no other role.
