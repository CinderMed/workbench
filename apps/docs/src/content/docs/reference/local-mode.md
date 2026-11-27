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

## The mapping grid

Once a project is open, the mapping grid shows one table at a time; a project with several tables has a switcher above the grid. Each line is a mapping row, and each column of the table that no row reads yet has an empty line, so every column is on screen. Rows without a column (constants and references) come last.

| Column                   | Shows                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| ID                       | The row code (`R-031`)                                                                    |
| Source variable, Type    | The column the row reads                                                                  |
| Role                     | The role it writes to, as `Type[n] · label`                                               |
| Element                  | The path in the role (`valueQuantity`, `component[nrs].valueInteger`)                     |
| Transform, Values / code | The transform, and a summary: the value map, the unit, the code system or the target role |
| Status                   | The review status                                                                         |

**Path picker.** Enter (or a double-click) on an Element cell opens the element tree of the row's role, from the FHIR definitions written by `cindermed fhir-index`: each element with its cardinality and types, choice elements under their concrete names (`valueQuantity`, `valueCodeableConcept`). Up and Down move, Right opens an element, Left closes it, Enter chooses; the search box finds elements by name among those opened (backbone elements such as `component` are always opened, datatypes such as `HumanName` when you open them). F2 types the path by hand instead, and so does the cell when there are no definitions. A row needs its role before the picker can open. The picker also checks each element against the row's column and transform, with the same type rules as the checks below. An element the row can never be written to is greyed and cannot be chosen, and the reason shows under the tree (a `boolean` column on `Patient.name`, a HumanName). An element that needs another transform can be chosen, and the picker names it: a conversion, a value map, a quantity or a coding, set in the Transform cell afterwards. A new row starts as a copy, so its element is checked against every transform its column can take; once you choose a transform, only that one counts.

**Named slices.** Without a slice, every row that writes to a repeating element such as `component` writes into the same repetition. To write several, give each one a name: select the repeating element in the picker and choose "Name a repetition of component". The form asks for:

- the **name**: letters, digits and `-`, starting with a letter (`nrs` gives `component[nrs]`);
- the child that **tells the repetitions apart**, `code` when the element has one;
- its **fixed value**: a code system and code (and an optional display) for a code, or a value of the child's type. A code typed here is saved as entered by hand (`manual`), not checked against a terminology server.

The new slice is saved in the role and shows open under its element, ready for a child such as `component[nrs].valueInteger`. The resource gets the repetition only when one of its rows has a value.

**Transforms.** Enter, F2 or a double-click on a Transform or Values cell opens the row's transform:

| Transform     | What it writes                                                                                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy          | The column's value as it is; its type must fit the element                                                                                                                                                                                                                                                                                   |
| Conversion    | The value converted: integer to decimal, date to dateTime, any type to string; for dates, the format in the data file (`dd/MM/yyyy`), taken from the column when it has one                                                                                                                                                                  |
| Value map     | Each value as a code, a coding or true/false, through one of the project's value maps                                                                                                                                                                                                                                                        |
| Quantity      | The number with a fixed UCUM unit (`kg`, `mm[Hg]`), with the unit read from another column and turned into UCUM by a value map, or with the unit text of another column copied as it is (optionally also as the code of a code system you give)                                                                                              |
| Coding        | The column's value as a code of one code system, written as a Coding or a CodeableConcept, with the display from another column if you choose one                                                                                                                                                                                            |
| Concatenation | The values of several columns of the same table joined into one text, in the order you tick them, with a separator (a space by default). Empty columns are skipped; when all are empty, nothing is written. The columns are text, categories, integers or decimals (a decimal keeps its digits: `1.50`); the element is a string or markdown |

A row of a multiple-choice column can also write **one repetition per selected value** (`repeat`), for a repeating element such as `Procedure.bodySite`. **Add constant row** writes the same value in every resource of a role, with no column: choose the role, the element and the value's type and value. A code typed by hand is saved as `manual`. References are set with the roles' context, and value maps are edited, in later versions; until then they come from the project file.

**Filters and bulk actions.** Above the grid, three filters show only the rows with a review **status**, a **role** or a **section** (or none of them); they combine, and "Clear filters" shows every line again. To change several rows at once, select them: Space on a row, Ctrl-click (Cmd-click on a Mac) to add or remove one, Shift-click for the rows in between, or "Select all shown" for every row the filters leave. "Set role…" and "Set status…" then write all the selected rows in one change: all of them are saved, or none. A new filter clears the selection, so a bulk action only writes rows on screen.

**Groups.** The switch above the grid groups the rows **by section** of the source table (the columns' sections, in their order) or **by role** (the role each row writes to). Rows with no section or no role come last, under "No section" or "No role"; a table without sections is one list when grouped by section. A group's header shows how many rows it holds; Enter or a click on it closes and opens it.

The grid works from the keyboard, as a spreadsheet: arrows or Tab to move, Enter (or F2) to edit, Enter again to save and go down, Esc to cancel. **Role** and **Element** are edited in their cells; **Transform** and **Values / code** open the transform editor. On an empty line, the new row is saved once it has both a role and an element. A value the project cannot take (for example an element that is not a path) stays in its cell, in red, with the reason.

## Checks while you map

After every change the project is checked again, with the same rules as [`cindermed validate`](/workbench/reference/cli/#cindermed-validate): schema, integrity and quality, then the FHIR checks (paths, types, bindings, references, cardinality) when the definitions are there. The checks run in the background, and an older check never colours the cells after a newer change.

- Above the grid, the number of errors and warnings, and whether the FHIR checks ran. Without definitions, it says how to write them with `cindermed fhir-index`.
- In the grid, a cell with an error is red and a cell with a warning is yellow. For example a `boolean` column copied to `Patient.name`, a HumanName, makes the Element cell red.
- **Details bar.** Under the grid, a bar shows every finding of the selected cell: its severity, code and message. It follows the selection, with the mouse and the keyboard, and screen readers read it as the cell's description. Pointing at a cell shows the same in a tooltip.
- **All findings.** "Show all findings" in the summary lists every finding with its code, message, row and column. Choosing one selects its cell, switching table or opening its group when needed. Findings that belong to no cell (for example a role no row uses) are listed too.
- Errors block the export, as on the command line, but never stop you from saving.

## Roles

The **Roles** tab lists the project's roles: the FHIR resources made from each record, such as `Patient[0]` or `Observation[1]`. A new project from `cindermed init` has none, so this is where mapping starts.

- **Add role** asks for the resource type (as in FHIR: `Patient`, `Observation`), the index (the next free one for that type), a label and the table. A new role makes one resource per record.
- **Id rule.** A role gets a default id rule: its name (`observation1`) and the table's row key columns, so two roles of the same table get different ids. A table without a row key (as `cindermed init` writes it) gives no id rule yet. While the id rule is the default one, it follows the role's type, index and table when they change.
- **Delete** asks first, and says how many rows use the role. Those rows stay, with an error, until you give them another role.
- **Named slices.** Each role lists its named slices (`component[nrs]`); pointing at one shows its fixed value. The cross on a slice deletes it, after saying how many rows write to it. Those rows stay, with an error, until you change their paths. Slices are added from the path picker.

How many resources a role makes, its conditions and fixed values are set in a later version.

## Smoke test in a browser

A Playwright test checks the local mode end to end in Chromium: it writes the real FHIR R4 definitions of the Metastra example, starts the development server on `127.0.0.1`, opens Metastra, breaks a path and expects the cell to turn red with `PATH_NOT_FOUND` in the details bar, and no error in the browser console. It runs in CI ("E2E (local mode)"); to run it on your computer:

```bash
pnpm -r build
pnpm --filter @cindermed/web exec playwright install --only-shell chromium   # once: about 130 MB in ~/.cache/ms-playwright
pnpm --filter @cindermed/web e2e   # E2E_PORT=5191 to run next to an open pnpm dev
```
