---
title: Command line
description: The cindermed command and its exit codes.
---

`cindermed` checks project files from a terminal or a CI job, without the web app.

## Run it from the repository

The command is not published to npm yet. Build the packages once, then run it with pnpm from the repository root:

```bash
pnpm install
pnpm -r build
pnpm cindermed validate fixtures/fml-examples/motu/project.json
```

Relative paths are resolved from the repository root.

## `cindermed validate`

```text
cindermed validate <project.json> [--format text|json]
```

Reads a [project file](/workbench/reference/project-file/) and runs two levels of project validation:

1. **Schema**: the file matches the project JSON Schema.
2. **Integrity**: the nine rules the schema cannot express (unique ids, internal references, `via` relations, value map values, resource id length, `repeat`, allowed values that fit the column type). They run only when the schema check passes.

The FHIR checks (paths, types, cardinality) come in a later version.

A valid project prints one line:

```text
$ pnpm cindermed validate fixtures/fml-examples/metastra/project.json
fixtures/fml-examples/metastra/project.json: valid (format 1.3.0)
```

An invalid project lists one line per problem: severity, code, object kind and id, field inside the object, and the message.

```text
broken.json: 1 error
  error DUPLICATE_ROW_CODE mapping map_02 (code): row code R-001 is already used by map_01
```

The codes are stable, so scripts can rely on them.

### JSON output

`--format json` prints a report for scripts:

```json
{
  "file": "fixtures/fml-examples/motu/project.json",
  "valid": true,
  "formatVersion": "1.3.0",
  "results": []
}
```

Each item of `results` has the fields `severity`, `code`, `objectKind`, `id`, `field` and `message`. The report also has `migratedFrom` when the file was written in an older format.

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| 0    | The project is valid                                                |
| 1    | The project has errors (including a file that is not JSON)          |
| 2    | The command could not run: wrong arguments or a file it cannot read |
