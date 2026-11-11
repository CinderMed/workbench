// Rule 7: generated ids respect the FHIR limit of 64 characters, fixed parts included.
// The id follows the normalization contract (IdField): the literal parts, then the encoded column
// values, joined by the separator. With `hash` the column values become one hash of `hashLength`
// characters, so the length is known in advance. With `sanitize` it depends on the data: the check
// counts the fixed parts and one character per column (ADR-0005).
import type { Instance } from "../generated/project.js";
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { Owner, ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export const MAX_ID_LENGTH = 64;
export const DEFAULT_SEPARATOR = "-";
export const DEFAULT_HASH_LENGTH = 24;
const ID_CHARACTERS = /^[A-Za-z0-9.-]*$/;

/** Length of the generated id: exact with `hash`, the minimum with `sanitize`. */
export function idLength(idRule: NonNullable<Instance["idRule"]>): number {
  const separator = idRule.separator ?? DEFAULT_SEPARATOR;
  const literals = idRule.parts.flatMap((part) => ("literal" in part ? [part.literal] : []));
  const columns = idRule.parts.length - literals.length;
  const hashed = (idRule.encoding ?? "hash") === "hash";
  // hash: one piece for all the columns; sanitize: one piece of at least one character per column.
  const encodedPieces = columns === 0 ? 0 : hashed ? 1 : columns;
  const encodedLength =
    columns === 0 ? 0 : hashed ? (idRule.hashLength ?? DEFAULT_HASH_LENGTH) : columns;
  const literalLength = literals.reduce((sum, literal) => sum + literal.length, 0);
  const pieces = literals.length + encodedPieces;
  return literalLength + encodedLength + separator.length * (pieces - 1);
}

export function checkResourceIds(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const instance of index.project.instances) {
    const idRule = instance.idRule;
    if (idRule === undefined) continue;
    const owner: Owner = { objectKind: "instance", id: instance.id };

    idRule.parts.forEach((part, i) => {
      if ("literal" in part && !ID_CHARACTERS.test(part.literal)) {
        results.push(
          error(
            IntegrityCode.ID_INVALID_CHARACTERS,
            owner,
            `idRule.parts.${String(i)}.literal`,
            `'${part.literal}' has characters not allowed in a FHIR id (letters, digits, '-' and '.')`,
          ),
        );
      }
    });
    if (idRule.separator !== undefined && !ID_CHARACTERS.test(idRule.separator)) {
      results.push(
        error(
          IntegrityCode.ID_INVALID_CHARACTERS,
          owner,
          "idRule.separator",
          `separator '${idRule.separator}' has characters not allowed in a FHIR id (letters, digits, '-' and '.')`,
        ),
      );
    }

    const length = idLength(idRule);
    if (length > MAX_ID_LENGTH) {
      const atLeast = (idRule.encoding ?? "hash") === "sanitize" ? "at least " : "";
      results.push(
        error(
          IntegrityCode.ID_TOO_LONG,
          owner,
          "idRule",
          `generated ids have ${atLeast}${String(length)} characters, more than the FHIR limit of ${String(MAX_ID_LENGTH)}`,
        ),
      );
    }
  }

  return results;
}
