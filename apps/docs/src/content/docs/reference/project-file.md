---
title: Project file
description: The JSON file that holds a whole mapping project.
---

A project file is one JSON document with the whole mapping project: tables and columns, roles, mapping rows, value maps, templates and review comments. It is the native format of CinderMed. You can export it, keep it in git and import it again.

The format is described by the JSON Schema `mapping-project.schema.json`, format version 1.2.0. The two example projects in the repository are good starting points:

- `fixtures/fml-examples/metastra/project.json`: one table, 11 variables
- `fixtures/fml-examples/motu/project.json`: three tables linked by a relation

Check a file with [`cindermed validate`](/workbench/reference/cli/).

## Format version

`formatVersion` follows semantic versioning:

| File version                         | What happens                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| Same major and minor (any patch)     | Read as it is                                                      |
| Same major, older minor (e.g. 1.0.0) | Read as it is; saved again as 1.2.0                                |
| Older major                          | Migrated automatically, one major at a time                        |
| Newer minor or major (e.g. 1.3.0)    | Rejected with `UNSUPPORTED_FORMAT_VERSION`: update CinderMed first |

## Written files

CinderMed always writes a project in the same way, so that saving an unchanged project gives the same text and git diffs show only real changes:

- the keys of each object follow the order of the schema (for example `id` first), and keys the schema does not name, such as those inside `extensions`, follow in alphabetical order
- lists keep their order
- two-space indentation and a final newline

The order of keys in a file you write by hand does not matter: CinderMed reads it and writes it back in this order.
