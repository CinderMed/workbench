---
"@cindermed/model": minor
"@cindermed/web": minor
---

Local mode of the web app (#173, ADR-0021): in the Vite dev server only, bound to 127.0.0.1 (any other address stops the server), the app opens a project file from this computer, keeps it in memory and saves it back object by object through `LocalFileStore`; the production build does not contain it. `@cindermed/model` adds `applyChanges` (create, update and delete of project settings, tables, columns, relations, roles, rows and value maps, refused only when the result would not match the schema), `nextRowCode` and `objectKey`.
