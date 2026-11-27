---
"@cindermed/model": patch
"@cindermed/fhir-defs": patch
"@cindermed/fml": patch
"@cindermed/normalizer": patch
"@cindermed/export": patch
"@cindermed/cli": patch
---

Each package now has the metadata a publish needs: `repository`, `homepage`, `bugs`, `engines` (Node 22.12 or later), a README and the LICENSE. Its tarball holds only `dist/` without source maps, its LICENSE and its README. Nothing is published: npm publishing is deferred after the MVP (#199), and every package stays private.
