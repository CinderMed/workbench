# ADR-0013: FHIR definitions: package cache and compact definition index

- Status: proposed
- Date: 2026-11-12
- Module: 3 (FHIR definitions and validation)

## Context

`@cindermed/fhir-defs` answers four questions about FHIR definitions: resource types, element trees, path resolution and reference targets. D7 and F4 use the answers in the CLI and the API (this module), and the path picker (D3, module 7) uses them in the browser. The answers come from the StructureDefinitions of the project's FHIR version, `hl7.fhir.r4.core` 4.0.1 or `hl7.fhir.r5.core` 5.0.0, and of any IG packages the project lists.

Constraints:

- The domain packages do no I/O (ADR-0001), and the same packages run in the browser.
- The core packages are large: 49 MB (R4) and 93 MB (R5) extracted, 4,578 and 2,968 resources. The browser must never load a whole core package.
- The path picker needs a type's elements one type at a time: the element tree of the role's resource, then the datatypes the user opens.
- The specification says packages come from packages.fhir.org, are kept on a volume and are downloaded only the first time.

## Decision

### Compact definition index

The workbench reads FHIR definitions only through a **compact definition index** built from the packages. The index is a manifest (`index.json`) plus one small document per type or profile, loaded when needed.

**What is kept.** Every StructureDefinition with a snapshot whose kind is `resource`, `complex-type` or `primitive-type`, and their profiles. Left out: logical models; extension definitions, since extensions cannot be mapped in the MVP; and every other resource type (ValueSets, SearchParameters and so on). A definition without a snapshot is left out with the warning `DEFINITION_WITHOUT_SNAPSHOT`, since the workbench does not generate snapshots. In the core packages that happens only to two example profiles, `example-composition` and `example-section-library`.

**Manifest (`index.json`).**

| Field         | Content                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `indexFormat` | `1.0.0`                                                                                                                                                                                                                                     |
| `fhirVersion` | `4.0.1` or `5.0.0`                                                                                                                                                                                                                          |
| `packages`    | `[{id, version}]`: the core package first, then the others by id and version                                                                                                                                                                |
| `entries`     | One per type or profile, sorted by `file`: `url`, `name`, `type`, `kind`, `abstract`, `derivation` (absent for the roots), `baseDefinition`, `package` (`<id>#<version>`), `file`, `sha256` (of the document's UTF-8 bytes), `size` (bytes) |

**Documents.** Types are `types/<type>.json`; profiles are `profiles/<package id>/<StructureDefinition id>.json`. A document repeats `indexFormat`, `url`, `name`, `type`, `kind`, `abstract`, `derivation` and `baseDefinition`, and holds `elements`: the snapshot in its order, each element with only these fields:

| Field                                    | Rule                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                                     | Always                                                                                                                  |
| `path`                                   | Only when it differs from `id` (slices)                                                                                 |
| `min`, `max`                             | Always                                                                                                                  |
| `type`                                   | `[{code, profile?, targetProfile?}]`                                                                                    |
| `contentReference`, `short`, `sliceName` | When present                                                                                                            |
| `binding`                                | `{strength, valueSet?}`                                                                                                 |
| `slicing`                                | `{discriminator?, rules, ordered?}`                                                                                     |
| `fixed`, `pattern`                       | `{type, value}`. The type comes from the `[x]` suffix: `fixedUri` → `uri`, `patternCodeableConcept` → `CodeableConcept` |
| `isModifier`, `mustSupport`              | Only when `true`                                                                                                        |

`definition`, `comment`, constraints, mappings and the rest are left out. The path picker shows `short`, and the FHIR specification has the full text.

**Serialization.** Compact JSON (`JSON.stringify` with no spacing), written by the builder only. The same packages give the same bytes in any order of input. An index is identified by the SHA-256 of its manifest text (`indexId`): it is content-addressed.

**Format versions.** A reader accepts every `1.x.y` index. A new optional field is a minor version; anything else is a major one. The index is a format the API serves and the browser reads. It is not a project contract (CLAUDE.md), but it follows the same versioning rule. The binding checks (branch 5) may add ValueSet expansion documents as a minor version.

**Sizes** (measured, `tooling/fhir-core-index.test.ts`):

|                                   | R4                          | R5                          |
| --------------------------------- | --------------------------- | --------------------------- |
| Entries                           | 255                         | 295                         |
| Concrete resource types           | 146                         | 158                         |
| Manifest                          | 105 kB                      | 121 kB                      |
| All documents                     | 2.0 MB                      | 2.9 MB                      |
| Largest document                  | ExplanationOfBenefit, 47 kB | ExplanationOfBenefit, 58 kB |
| Patient / Observation / HumanName | about 8 / 11–14 / 1.5 kB    |                             |

No document may exceed 64 KiB (tested on the core packages). Opening the path picker on an Observation loads the manifest and one 14 kB document. Each datatype the user opens adds one small document.

### Where each part lives

- **`@cindermed/fhir-defs`** (domain, no I/O, depends only on `@noble/hashes`):
  - `buildIndex(fhirVersion, packages)` builds the manifest and documents from package contents that the caller has read and parsed. It checks that the core package of the version is present (`CORE_PACKAGE_MISSING`), that every package is for that FHIR version (`PACKAGE_FHIR_VERSION_MISMATCH`), and that no URL or file appears twice (`DEFINITION_DUPLICATE`).
  - `FhirDefinitions.open(manifest)` reads a manifest.
  - `add(file, text)` checks a document against the manifest's SHA-256, its format and its URL before use.
  - `load(refs, fetch)` fetches the documents not loaded yet, in parallel, through a function the caller provides. In the browser that function is an HTTP call to the API.
  - Questions that need only the manifest, such as `resourceTypes()` and `entry()`, need no document.
  - `CORE_PACKAGES` pins, for each FHIR version, the core package and the SHA-256 of its tarball.
  - `fhir-defs` does not depend on `fml`. The validation functions of D7 and F4 (`validateFhir(project, defs)`) will live here, on top of `@cindermed/model`.
- **The Node package loader** is `apps/cli/src/fhir-packages.ts`. The API will reuse it in module 4, and it moves to a shared Node package then if both apps need it.
  - **Cache.** The FHIR package cache, `~/.fhir/packages/<id>#<version>/package/`, the folder the HL7 validator and other FHIR tools share. A different folder can be given, for a volume in the API container.
  - **Download.** A missing package comes from `https://packages.fhir.org/<id>/<version>`.
    - Core packages are checked against the pinned SHA-256.
    - Other packages are checked against the SHA-1 the registry metadata gives (`versions[v].dist.shasum`), and are refused when there is none.
    - The tarball's `package/` folder is extracted with `tar` (node-tar 7.5.22: streaming, long names, no `..` or absolute paths) into a temporary folder in the cache, then renamed into place. The cache never holds half a package.
  - **Offline mode.** A missing package is an error, never a download.
  - **Reading.** With the package's `.index.json`, only the StructureDefinition files are parsed; without it, every JSON file is. Dependencies (`package.json`) are loaded transitively. One package needed in two versions is an error.
  - `writeIndex(index, dir)` writes the files as the API serves them.
- **The API** (module 4) builds an index once per FHIR version and package list, keeps it on its volume, and serves it read-only and cacheable under its id: `/fhir-defs/<indexId>/index.json` and `/fhir-defs/<indexId>/<file>`. The exact routes are fixed in module 4.

### Checked

- The pinned digests match the tarballs downloaded from packages.fhir.org on 2026-11-12.
- The HL7 validator rewrites packages in its cache: it rewrites `.index.json` and `package.json`, moves `openapi/` and `other/` into `package/`, and drops three extension definitions in R4. The index built from its copy is byte-identical to the one built from a fresh download, because nothing the index keeps changes.

## Consequences

- The browser loads the manifest (about 105–121 kB) and a few documents of 1–60 kB, never a core package. The same `fhir-defs` code answers in the browser, the API and the CLI.
- An index's id changes whenever its content changes, so the API and the browser can cache its files forever.
- The core packages are downloaded once per machine: about 12.8 MB and 17.1 MB compressed, about 6 s each. CI caches `~/.fhir/packages` in the Unit tests job, where `tooling/fhir-core-index.test.ts` builds both indexes (`FHIR_CORE_PACKAGES=1`).
- Profiles without a snapshot cannot be used. If projects need IGs published without snapshots, snapshot generation is a new decision.
- A new FHIR version needs a new `CORE_PACKAGES` entry with its tarball digest.
- Revisit the element fields if the path picker needs more than `short` (for example `definition` on demand). That would be a minor format version, or a separate document type.
