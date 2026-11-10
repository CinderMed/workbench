---
title: Getting started
description: Run the CinderMed development stack on your computer.
---

CinderMed runs with Docker Compose: the web app, the API, PostgreSQL and Keycloak for sign-in.

## Requirements

- Docker with Docker Compose v2.20 or later
- Git

## Start the stack

```bash
git clone https://github.com/CinderMed/workbench.git
cd workbench
docker compose up --build
```

When the services are up, open `http://localhost:8080`. You are sent to the sign-in page.

## Sign in

The development realm has one test user for each project role:

| User       | Role in a project                                     |
| ---------- | ----------------------------------------------------- |
| `owner`    | Owner: settings, members, approval                    |
| `mapper`   | Mapper: edits the source, roles, rows and value maps  |
| `reviewer` | Reviewer: comments and approves                       |
| `engineer` | Engineer: edits, plus expert expressions and FML view |
| `viewer`   | Viewer: read only                                     |

The password is `cindermed-dev`, unless you set `CINDERMED_DEV_PASSWORD`. These accounts and passwords are for local development only.

:::note
Project roles are assigned per project once project management is available. For now, signing in shows who you are.
:::

## Change ports and passwords

Copy `.env.example` to `.env` and edit the values. By default the web app uses port 8080, the API port 3000 and Keycloak port 8081.
