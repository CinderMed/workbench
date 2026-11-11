# ADR-0006: Reading, writing and versioning the project file

- Status: accepted
- Date: 2026-11-11
- Module: 1 (Domain core)

## Context

H3 makes the JSON project file the native format: it is exported, imported and kept in git. The specification says that `formatVersion` follows semver and that an incompatible change needs an automatic migration ("Format version"). It does not say how files are written, what happens with a newer version, or what the `cindermed validate` command prints and returns.

The API stores projects in PostgreSQL JSONB, which does not keep the key order of objects. Writing keys in input order would therefore change the file on every round trip and fill git diffs with noise.

## Decision

**Writing (`serializeProject`).**

- Keys follow a canonical order taken from the project schema. The keys an object's definition declares come first, in the order of its `properties`. The definition includes `$ref`, `allOf`/`oneOf`/`anyOf` and `then`/`else` branches. Any other key (open maps such as `extensions`, `typeRules`, template `arguments`) follows in code-unit order. Arrays keep their order.
- Two-space indentation and a final newline.
- The two example fixtures do not follow one consistent key order, so they are not byte-identical after a round trip. The tests check that a round trip keeps the same content, that serialization is idempotent, and that the output does not depend on the input key order. The fixtures are left unchanged.

**Reading (`parseProject`).** The steps are JSON parse, then version handling, then schema, then integrity.

- `project` is returned whenever the schema check passes, even with integrity errors, so a client can open a project and fix it.
- Text that is not JSON gives `INVALID_JSON`.

**Format versions.** Only major and minor are compared, because a patch never changes what a file may contain.

- Same major and minor: read as it is.
- Same major, older minor: compatible by definition; read as it is, `formatVersion` set to the current version, and `migratedFrom` reported.
- Older major: the migrations in `PROJECT_MIGRATIONS` run one major at a time (`fromMajor` → `fromMajor + 1`). If one is missing, the result is `UNSUPPORTED_FORMAT_VERSION`. The registry is empty while the format is at major 1.
- Newer minor or major: `UNSUPPORTED_FORMAT_VERSION`. A newer minor may add fields that this version's schema rejects or, worse, would silently drop on the next save.
- A missing or malformed `formatVersion` is left to the schema check.

**Command line (`cindermed validate`).**

- `run(args, io)` takes its I/O as parameters, and `bin.ts` only wires it to the process. The tests drive the command without spawning a process.
- Exit codes:
  - 0: valid
  - 1: the project has errors, including invalid JSON
  - 2: the command could not run (usage error, unreadable file)
- `--format json` prints `{file, valid, formatVersion, migratedFrom, results}`.
- Arguments are parsed with `node:util` `parseArgs`, so no dependency is added.

## Consequences

- Saving an unchanged project always gives the same text, whatever the storage did to the key order.
- Adding a property to the schema changes where it is written. This is a compatible change (a new minor), and existing keys keep their order.
- A future major needs its migration registered in `PROJECT_MIGRATIONS` and tests from a file of the old major.
- The `formatVersion` of an older-minor file changes when it is saved again, which shows up as a one-line diff.
