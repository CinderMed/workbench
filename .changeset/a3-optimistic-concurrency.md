---
"@cindermed/api": minor
---

Safe concurrent saving (A3, #20, ADR-0028). Every update, delete and settings change carries the version it read in `If-Match`, and reads give it as an `ETag`. A write without the header gets 428. A write on a version that changed meanwhile gets 409, with each object's current version and value, so the UI can compare and choose. `POST /api/projects/{p}/entities:batch` applies up to 2000 changes in one transaction, all or nothing (D8). Request bodies are validated strictly: an unknown field or a wrong type is a 400, never dropped or converted.
