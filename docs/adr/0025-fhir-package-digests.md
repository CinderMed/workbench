# ADR-0025: The export manifest pins every FHIR package by the SHA-256 of its tarball

- Status: accepted
- Date: 2026-11-27
- Module: 3b (long tables and publishing)
- Issue: #146

## Context

A project is checked against the definitions of its FHIR packages: the core package, the IG packages in `project.packages`, and their dependencies (D7, F4). The conversion module (V2) must check that it runs against the same definitions. Until manifest 1.0.0, the export listed only the core package and `project.packages`, by name and version, with no digest.

The core packages' tarball digests are pinned in `@cindermed/fhir-defs` (ADR-0013). For the other packages, the loader checks only the registry's SHA-1 at download. The shared FHIR package cache (`~/.fhir/packages`) keeps extracted folders, not tarballs, and other tools such as the HL7 validator also put packages there.

The user approved the manifest's minor version (1.1.0) on 2026-11-13, and made the choices below on 2026-11-27.

## Decision

- **Manifest 1.1.0.**
  - `packages` lists every package the definitions were built from: the core package first, then the others by name, dependencies included.
  - Each entry has an optional `sha256`, the SHA-256 of the package tarball as the registry publishes it. The export always writes it. It stays optional in the schema so that 1.0.0 manifests still validate.
  - `formatVersion` accepts every 1.x.y, as the project and normalization schemas do.
- **Definition index 1.2.0.** Each package of the index manifest has an optional `tarballSha256`, so the digest travels with the definitions to every consumer (CLI, API, browser), and the export reads it from the definitions it was given.
- **Where the digest comes from.**
  - A core package: the pinned digest.
  - Another package: the loader computes the SHA-256 when it downloads the tarball, after checking the registry's SHA-1. It keeps the digest next to the package in the cache, in `<id>#<version>/cindermed.json`, outside the `package/` folder other tools read.
  - A package in the cache without that file (installed by another tool): the loader downloads the tarball again, checks the SHA-1, computes the SHA-256 and keeps it. It doesn't extract the tarball again.
  - Offline, with no kept digest: the digest is unknown.
- **An unknown digest blocks the export** (`EXPORT_PACKAGE_DIGEST_MISSING`, error), so a manifest always pins every package. The message says to export once with downloads on. Validation doesn't need digests, so it works offline.

## Alternatives considered

- **Re-download every non-core tarball on each export.** This writes nothing into the shared cache, but every export needs the network and repeats the download.
- **Warn and leave the digest out.** Offline exports keep working, but the package no longer pins its definitions, and the conversion module could not check them.
- **The CLI passes the digests to the export separately.** This needs no index change, but each consumer (the CLI now, the API later) would have to carry them alongside the definitions.
- **List only the core package and `project.packages`.** The dependencies are part of the definitions the mapping was checked against, so leaving them out would leave them unpinned.

## Consequences

- Every manifest written from now on is 1.1.0. The committed fixtures' manifests change only in `formatVersion` and the core package's `sha256`.
- `cindermed export --offline` of a project with an IG package fails until the package has been digested once online.
- The cache gets one small file per non-core package that CinderMed downloads or digests.
