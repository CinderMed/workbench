# ADR-0002: English as the project language

- Status: accepted
- Date: 2026-11-09
- Module: 0 (Foundations)
- Source: docs/specification.md, "Language" and "Architecture decision records"

## Context

CinderMed is developed in Italy on Italian datasets (Metastra, MOTU), but it targets an international standard (FHIR), is open source and aims at outside contributors and users.

## Decision

Everything in the repositories is written in English:

| Where                                                                 | Rule                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Code, identifiers, comments, error messages, JSON Schemas, CLI output | English                                                                                                                                       |
| Commits, pull requests, issues, ADRs, the specification               | English                                                                                                                                       |
| User interface                                                        | English as the source locale; every string goes through i18next, so an Italian locale (`it`) is added as a translation, never by editing code |
| Documentation site and website                                        | English first; Italian added later with the sites' built-in i18n                                                                              |
| Test data                                                             | Kept as it is in the source: Metastra values, Italian date and number formats and boolean words (`Sì`/`no`) are deliberate test cases         |

## Consequences

- Contributors and reviewers outside Italy can work on every part of the project.
- UI text is never hard-coded: the web app reads it from `en.json`, and review checks that new strings go through i18n (definition of done).
- The documentation site has English as its root locale and is configured to add Italian without moving pages.
- Italian test data stays untranslated: translating it would remove the cases the normalizer must handle.
