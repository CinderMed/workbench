# @cindermed/api

## 0.1.0

### Minor Changes

- 48047b9: Module 1 (Domain core): the project model with its JSON Schemas and generated types, the eight integrity rules (structural parts), the JSON project file (H3), and the `cindermed validate` command. The API and web app do not use them yet.

## 0.0.1

### Patch Changes

- 4735681: First development stack: the API answers `GET /api/health`, and the web app signs users in through Keycloak (authorization code flow with PKCE) and shows who is signed in. `docker compose up` starts the web app, the API, PostgreSQL and Keycloak with a development realm.
