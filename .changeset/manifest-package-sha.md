---
"@cindermed/model": minor
"@cindermed/fhir-defs": minor
"@cindermed/export": minor
"@cindermed/cli": minor
---

The export manifest pins its FHIR packages (manifest format 1.1.0, #146, ADR-0025). `packages` lists every package the definitions were built from, dependencies included, each with the SHA-256 of its tarball. The digest is pinned for the core packages; for the others the CLI computes it at download and keeps it in the package cache (`<id>#<version>/cindermed.json`), downloading the tarball again for a package cached without it. An unknown digest blocks the export with `EXPORT_PACKAGE_DIGEST_MISSING`. The definition index (format 1.2.0) carries the digest of each package as `tarballSha256`. 1.0.0 manifests still validate.
