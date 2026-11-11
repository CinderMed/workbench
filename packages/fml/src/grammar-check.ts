/**
 * Grammar check (G10): parses FML text with the official grammar mapping.g4, pinned at
 * HL7/mapping-language-ig commit 8bb04b4, in TypeScript and without Java (ADR-0008).
 *
 * The generated maps follow the grammar by construction, so an error here is a bug in the
 * generator or in an expert expression (D6). Errors are traced back to the rule of the printed
 * map, and through it to the mapping row or role that produced the rule.
 */
import type { ObjectKind, ValidationResult } from "@cindermed/model";
import { BaseErrorListener, CharStream, CommonTokenStream } from "antlr4ng";
import type { RuleName } from "./fml-ast.js";
import { ruleAtLine, type PrintedMap } from "./fml-print.js";
import { mappingLexer } from "./grammar/generated/mappingLexer.js";
import { mappingParser } from "./grammar/generated/mappingParser.js";

/** Source of the pinned grammar, as recorded in the package manifest (`verification.grammar`). */
export const GRAMMAR_SOURCE = "HL7/mapping-language-ig input/images/mapping.g4";
export const GRAMMAR_COMMIT = "8bb04b4";

/** Stable result code of a grammar error. */
export const FML_GRAMMAR_ERROR = "FML_GRAMMAR_ERROR";

export interface FmlSyntaxError {
  /** 1-based line. */
  readonly line: number;
  /** 0-based column, as reported by ANTLR. */
  readonly column: number;
  readonly message: string;
}

class CollectingListener extends BaseErrorListener {
  readonly errors: FmlSyntaxError[] = [];

  override syntaxError(
    _recognizer: unknown,
    _offendingSymbol: unknown,
    line: number,
    column: number,
    message: string,
  ): void {
    this.errors.push({ line, column, message });
  }
}

/** Lexer and parser errors of an FML text, in the order they are found; empty when the text is valid. */
export function parseFml(text: string): FmlSyntaxError[] {
  const listener = new CollectingListener();
  const lexer = new mappingLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  lexer.addErrorListener(listener);
  const parser = new mappingParser(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  parser.addErrorListener(listener);
  parser.structureMap();
  return listener.errors;
}

/** Object a result points to. */
export interface ResultOwner {
  readonly objectKind: ObjectKind;
  readonly id?: string;
}

export interface GrammarCheckOptions {
  /**
   * Owner of a rule: the generator knows which mapping row (e.g. rule `R-006-1` → row `map_0006`)
   * or role (`Encounter0-id` → instance `ins_encounter0`) produced each rule.
   */
  readonly ownerOf?: (rule: RuleName) => ResultOwner | undefined;
  /** Owner of errors outside rules, or in rules without an owner (typically the source table). */
  readonly fallback: ResultOwner;
}

/** Checks a printed map against the grammar; one `FML_GRAMMAR_ERROR` result per syntax error. */
export function checkGrammar(
  printed: PrintedMap,
  options: GrammarCheckOptions,
): ValidationResult[] {
  return parseFml(printed.text).map((error) => {
    const rule = ruleAtLine(printed, error.line);
    const owner = (rule === null ? undefined : options.ownerOf?.(rule)) ?? options.fallback;
    const where = `line ${String(error.line)}:${String(error.column)}${rule === null ? "" : `, rule "${rule}"`}`;
    return {
      severity: "error",
      code: FML_GRAMMAR_ERROR,
      objectKind: owner.objectKind,
      ...(owner.id === undefined ? {} : { id: owner.id }),
      message: `FML grammar (mapping.g4 @${GRAMMAR_COMMIT}), ${where}: ${error.message}`,
    };
  });
}
