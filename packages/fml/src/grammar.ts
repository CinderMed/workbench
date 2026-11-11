/**
 * `@cindermed/fml/grammar`: the grammar check (G10), kept out of the package root so that the
 * generated parser and the antlr4ng runtime load only where the check runs, the backend in the
 * MVP (ADR-0008).
 */
export {
  FML_GRAMMAR_ERROR,
  GRAMMAR_COMMIT,
  GRAMMAR_SOURCE,
  checkGrammar,
  parseFml,
  type FmlSyntaxError,
  type GrammarCheckOptions,
  type ResultOwner,
} from "./grammar-check.js";
