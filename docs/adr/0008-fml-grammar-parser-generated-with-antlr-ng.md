# ADR-0008: FML grammar parser generated with antlr-ng

- Status: accepted
- Date: 2026-11-11
- Module: 2 (Generator and package)

## Context

G10 checks every generated StructureMap against the official grammar `mapping.g4`, in the backend and without Java ("Translation to FML: validity and coverage", level 2). The specification says the grammar must be pinned to an exact version: the Mapping Language IG keeps changing, and `fixtures/fml-examples/grammar/mapping.g4` is commit `8bb04b4` (16 October 2026). The verification prototype (`tools/verify-grammar.ts`) generated a TypeScript parser with antlr-ng and ran it with the antlr4ng runtime. It did not say where the generated code lives or how it is kept up to date.

The generated parser is about 5,000 lines of TypeScript, and antlr-ng's output does not depend on the machine: two runs give the same files.

## Decision

- The grammar is copied unchanged to `packages/fml/grammar/mapping.g4`. A test checks that it is byte-identical to the fixture. Changing it means a new pinned commit, a dedicated PR, and the golden suite run again.
- The lexer and parser are generated with **antlr-ng** (TypeScript target, no listener, no visitor) into `packages/fml/src/grammar/generated/`, with a "generated, do not edit" header and no timestamps. The output is **committed**, like the model types (ADR-0004), so builds need no code generation step.
- `pnpm codegen` regenerates the parser together with the model types. A drift test (`tooling/codegen/fml-grammar.test.ts`, in the Unit tests job) regenerates it into `.tmp/` and fails if it differs from the committed files.
- antlr-ng (development) and the **antlr4ng** runtime (`@cindermed/fml` dependency) are pinned to exact versions: generator and runtime must match.
- The generated files are excluded from ESLint, Prettier, coverage and CodeQL (`.github/codeql/codeql-config.yml`, which also excludes the model types of ADR-0004). They pass `tsc` with the repository's strict settings unchanged. They are never edited by hand, not even to apply a CodeQL autofix: the drift test fails on any manual change. A problem in generated code is fixed in the generator or the grammar.
- **The grammar check runs in the backend only** (in the MVP: `POST /verify` and `POST /exports`). It is exported from the subpath **`@cindermed/fml/grammar`**, not from the package root. Importing the printer, the types or the generator from `@cindermed/fml` (e.g. for the G6 FML view in `apps/web`) never loads the generated parser or antlr4ng. Two dependency-cruiser rules enforce this, each with a test in `tooling/boundaries.test.ts`:
  - `web-no-fml-grammar`: `apps/web` imports neither the subpath, nor the grammar sources, nor antlr4ng;
  - `fml-root-without-grammar`: the package root (`src/index.ts`) cannot reach the grammar check, even indirectly.
- `parseFml(text)` returns the lexer and parser errors with line and column. `checkGrammar(printed, { ownerOf, fallback })` turns them into `FML_GRAMMAR_ERROR` results with the standard shape. It finds the rule of each line with the printer's line index, and `ownerOf` maps the rule to the mapping row or role that produced it. Errors outside rules go to `fallback`.

## Consequences

- The check needs no Java: the API and the CLI run it in-process. Measured on the 111-line Metastra map: about 17 ms per parse once warm, about 160 ms for the first parse in a process.
- antlr4ng and about 230 KB of generated code load only through `@cindermed/fml/grammar`. The browser bundle does not carry them, even though the browser reuses the domain packages for immediate validation. If a later feature needs the check in the browser (e.g. instant feedback on an expert expression, D6), that needs a new decision that lifts `web-no-fml-grammar`.
- Upgrading antlr-ng or antlr4ng changes the generated files. The drift test makes the upgrade explicit: bump both, run `pnpm codegen`, and commit the output in the same PR.
- The grammar accepts some text the HL7 parser rejects (e.g. `///` metadata), and the HL7 parser accepts reserved words the grammar rejects. The grammar check is level 2 only. Level 3 (the HL7 engine) stays in the CI golden job, and moves to every export in V2.
