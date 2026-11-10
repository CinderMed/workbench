---
"@cindermed/api": patch
"@cindermed/web": patch
---

First development stack: the API answers `GET /api/health`, and the web app signs users in through Keycloak (authorization code flow with PKCE) and shows who is signed in. `docker compose up` starts the web app, the API, PostgreSQL and Keycloak with a development realm.
