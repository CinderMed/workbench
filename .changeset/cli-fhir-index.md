---
"@cindermed/cli": minor
"@cindermed/web": minor
---

`cindermed fhir-index <project.json> --out <folder>` writes the compact FHIR definition index of a project's FHIR version and packages (#173, ADR-0021); the web app's dev server serves `apps/web/.fhir-index` under `/fhir-index/` to the local mode, on localhost only and never in the production build.
