---
"@cindermed/cli": minor
---

`cindermed init <data.csv>` writes an empty project from a data file's header (#172, ADR-0022): one table, every column `string`, no roles or rows. Options `--delimiter`, `--encoding`, `--header-row`, `--fhir-version`, `--canonical-base`, `--name`, `--table`, `--out`; empty or duplicate headers are errors, and an existing file is never overwritten. `--infer` writes a separate type report with suggested types and counts only, never cell values.
