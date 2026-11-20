---
title: Local mode
description: Work on a project file in the browser on your own computer, without a server or login.
---

The local mode of the web app works on one project file on your computer, with no server, no database and no login. It is the mapping grid's mode until the platform arrives (module 4), and stays a developer tool afterwards.

:::caution
The local mode has no login, so it runs only on your computer: the development server listens on `127.0.0.1` and refuses to start on any other address, also with `--host`. Never run it on an address other people can reach. The production build and the Docker image do not contain it.
:::

## Start it

Build the packages once, then start the development server from the repository root:

```bash
pnpm -r build
pnpm --filter @cindermed/web dev
```

Open `http://127.0.0.1:5173`. A project to start from can be written with [`cindermed init`](/workbench/reference/cli/#cindermed-init).

The grid checks the project against the FHIR definitions in the browser, with the same rules as the command line. Write the definitions of the project's FHIR version and packages once (again when the project's packages change):

```bash
pnpm cindermed fhir-index my-project.json --out apps/web/.fhir-index
```

The development server serves that folder under `/fhir-index/`, only on `127.0.0.1`. The folder is not in git and not in the production build.

## Open and save

- **Open** a project file with the button, or drop it on the page. Only project files (`.json`) are opened. Data files are never opened or read here: a file with another name is refused before it is read.
- A file in an older format is migrated on opening, and saved in the current format.
- **Saving** depends on the browser:
  - In Chrome and Edge, the file you opened is rewritten after every change. If another program changed it in the meantime, the change is refused and you are asked to open it again.
  - In other browsers, the changes stay in the page until you **download** the project. Closing the tab with unsaved changes asks first.
- A change is refused only when the project would not match the schema. Integrity and FHIR errors are shown, and block the export as in the command line, but they never stop you from saving work in progress.
- Nothing is kept in the browser's storage: the project lives only in the page and in your file.
