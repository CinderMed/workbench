---
"@cindermed/fml": patch
---

Internal: the generator's working state no longer uses TypeScript parameter properties, so the sources type-check under `erasableSyntaxOnly` (used by the tooling tests that import them). No change in behaviour or output.
