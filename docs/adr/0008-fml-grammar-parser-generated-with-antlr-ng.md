# ADR-0008: FML grammar parser generated with antlr-ng

- Status: accepted
- Date: 2026-11-11
- Module: 2 (Generator and package)

## Context

G10 checks every generated StructureMap against the official grammar `mapping.g4`, in the backend and without Java ("Translation to FML: validity and coverage", level 2). The specification says the grammar must be pinned to an exact version: the Mapping Language IG keeps changing, and `fixtures/fml-examples/grammar/mapping.g4` is commit `8bb04b4` (16 October 2026). The verification prototype (`tools/verify-grammar.ts`) generated a TypeScript parser with antlr-ng and ran it with the antlr4ng runtime. It did not say where the generated code lives or how it is kept up to date.

The generated parser is about 5,000 lines of TypeScript, and antlr-ng's output does not depend on the machine: two runs give the same files.

## Decision

- The grammar is copied unchanged to `packages/fml/grammar/mapping.g4`. A test checks that it is byte-identical to the fixture. Changing it means a new pinned commit, a dedicated PR, and the golden suite run again.
- The lexer and parser are generated with **antlr-ng** (TypeScript target, no listener, no visitor) into `packages/fml/src/grammar/generated/`, with a "generated, do not edit" header and no timestamps. The output is **committed**, like the model types (ADR-0004), so builds and the browser bundle need no code generation step.
- `pnpm codegen` regenerates the parser together with the model types. A drift test (`tooling/codegen/fml-grammar.test.ts`, in the Unit tests job) regenerates it into `.tmp/` and fails if it differs from the committed files.
- antlr-ng (development) and the **antlr4ng** runtime (`@cindermed/fml` dependency) are pinned to exact versions: generator and runtime must match.
- The generated files are excluded from ESLint, Prettier and coverage. They pass `tsc` with the repository's strict settings unchanged.
- `parseFml(text)` returns the lexer and parser errors with line and column. `checkGrammar(printed, { ownerOf, fallback })` turns them into `FML_GRAMMAR_ERROR` results with the standard shape. It finds the rule of each line with the printer's line index, and `ownerOf` maps the rule to the mapping row or role that produced it. Errors outside rules go to `fallback`.

## Consequences

- The check runs anywhere `@cindermed/fml` runs (API, CLI, browser) with no Java. Measured on the 111-line Metastra map: about 17 ms per parse once warm, about 160 ms for the first parse in a process.
- antlr4ng adds about 230 KB of generated code plus the runtime to `@cindermed/fml`. If the web app's bundle size matters, the grammar check can be loaded on demand.
- Upgrading antlr-ng or antlr4ng changes the generated files. The drift test makes the upgrade explicit: bump both, run `pnpm codegen`, and commit the output in the same PR.
- The grammar accepts some text the HL7 parser rejects (e.g. `///` metadata), and the HL7 parser accepts reserved words the grammar rejects. The grammar check is level 2 only. Level 3 (the HL7 engine) stays in the CI golden job, and moves to every export in V2.
