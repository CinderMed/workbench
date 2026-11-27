---
"@cindermed/api": minor
---

The API stores projects in PostgreSQL, one row per object of the project file (#219, ADR-0026). It imports a project file (`POST /api/projects:import`) and exports it back byte for byte (`POST /api/projects/{p}/exports`, format `json`). It reads and changes the settings and each object, giving new objects an id, and keeps only changes that leave the project schema-valid. Errors are RFC 9457 problem details, and the OpenAPI document is at `/api/docs`. Every project route needs an authenticated member; until sign-in arrives (#19) no caller is accepted.
