---
"@cindermed/export": minor
"@cindermed/fml": minor
---

`exportPackage` writes the export package (G7): cleaned project copy, maps with StructureMap JSON, logical models, normalization specifications, ConceptMaps, the three schemas and a manifest with SHA-256 digests and load order, in a deterministic zip. Every map passes the grammar check first (G10). The logical models and ConceptMaps take the package version (`logicalModel(…, { version })`, `ConceptMapOptions.version`).
