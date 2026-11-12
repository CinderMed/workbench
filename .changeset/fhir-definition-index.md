---
"@cindermed/fhir-defs": minor
"@cindermed/cli": patch
---

`@cindermed/fhir-defs` builds and reads the compact FHIR definition index (ADR-0013): a manifest of the types and profiles of a FHIR version and its packages, and one small document per type, loaded on demand and checked against its SHA-256. The CLI gains the FHIR package loader (shared `~/.fhir/packages` cache, download from packages.fhir.org with pinned SHA-256 for the core packages, offline mode); no command uses it yet.
