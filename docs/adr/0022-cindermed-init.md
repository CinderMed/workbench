# ADR-0022: `cindermed init`

- Status: accepted
- Date: 2026-11-20
- Module: 7 (mapping grid, local mode)

## Context

The mapping grid of module 7 works on a project file, and the dictionary import that fills a project's tables (B1–B3) comes in module 5. `cindermed init` writes the starting project from a data file's header (#172). Decided on 2026-11-20:

- every column is `string`;
- options `--delimiter`, `--encoding`, `--header-row`;
- empty or duplicate headers are errors;
- `--infer` only suggests types, in a separate report with counts and no cell values;
- allowed values never come from the data.

## Decision

- **Reading** uses the normalizer's decoder and CSV reader (`@cindermed/normalizer`, a workspace package), with the normalizer's rules: the header is the `headerRow`-th non-empty record, and names are NFC and trimmed. So the names `init` writes are the names the normalizer will match. Without `--infer`, reading stops at the header, whatever the file's size.
- **A header with the replacement character** (`U+FFFD`, bytes not valid in the encoding) is an error that suggests `--encoding`, instead of silently writing broken names.
- **Ids** are readable: `prj_<name>`, `src_<table>`, `col_<column name>`. Characters outside `[A-Za-z0-9_-]` become `_` and accents are dropped. A name with no letters or digits gets its position (`col_003`), and a clash gets a suffix (`_2`).
- **The project** records how the file was read in `sources[].import` (`fileKind: data`, delimiter, encoding, header row, file name, import time). `--fhir-version` and `--canonical-base` are required: they are project settings that `init` cannot know.
- **Type suggestions (`--infer`)** use the model's parsers (`parseInteger`, `parseDecimal`, `parseBoolean`, `parseDate`, `parseDateTime`), so a suggested type is one the normalizer accepts. The types are tried from the most specific: integer, decimal with `.`, decimal with `,`, boolean, dates in ISO and day-first forms (`dd/MM/yyyy`, `dd-MM-yyyy`, `dd.MM.yyyy`), date-times in ISO and day-first forms. Month-first forms are not tried, because `03/04/2024` would be ambiguous and the sources are Italian. The suggestion is the first type every non-empty cell converts to, and `string` otherwise. The report gives, for every type, the number of cells that do not convert, so a column that is almost a date can be seen.
- **No values anywhere.** The report and the console output hold names, types and counts only. A test checks that no cell value of the input appears in any file written or in the output.
- **The code lives in `apps/cli`** (`src/init.ts`) for now. The import wizard (B2, module 5) will need the header check and the type counter. They move to a domain package then; until then, keeping them in the CLI is the simpler choice and easier to change.

## Consequences

- A suggestion is only a suggestion. For example, a multiple-choice cell such as `8,20` is suggested as a decimal with `,`. Types are set from the dictionary (B3) or by hand in the grid.
- `init` reads CSV only. XLSX comes with the import wizard (B1, module 5).
