---
"@cindermed/web": minor
"@cindermed/model": minor
"@cindermed/cli": patch
---

The signed-in app shows the user's projects (A1, H3, #18): the list with the user's role, a new project, a project file imported, and a project exported as JSON. A new project has a name, a description, a FHIR version (R4 or R5), a canonical base, its IG packages and its first table with the column names, because a project always has at least one table. Every API call carries the user's access token, which is renewed before it expires, and a session that has ended signs the user in again. In development, `VITE_APP_MODE=api` starts the signed-in app instead of the local mode. `checkHeader` and `newProject` (the project of `cindermed init`) move to `@cindermed/model`, as ADR-0022 planned, so the CLI and the web app make new projects the same way.
