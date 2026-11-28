---
"@cindermed/api": minor
---

History as infrastructure (#220). Every write keeps the state it leaves each object in, project settings included, with its version, author, date and kind of change (import, create, update or delete), in the same transaction as the write. `GET /api/projects/{p}/entities/{kind}/{id}/history` and `GET /api/projects/{p}/history` list an object's revisions, newest first. A deleted object keeps its history. The history UI and restore (A7) come in V2.
