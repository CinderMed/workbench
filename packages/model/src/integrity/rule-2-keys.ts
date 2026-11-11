// Rule 2: the pair `resourceType` + `index` is unique; the same holds for the `R-nnn` codes.
import type { ValidationResult } from "../validation-result.js";
import { IntegrityCode } from "./codes.js";
import type { ProjectIndex } from "./project-index.js";
import { error } from "./result.js";

export function checkKeys(index: ProjectIndex): ValidationResult[] {
  const results: ValidationResult[] = [];

  const roles = new Map<string, string>();
  for (const instance of index.project.instances) {
    const key = `${instance.resourceType}[${String(instance.index)}]`;
    const first = roles.get(key);
    if (first === undefined) roles.set(key, instance.id);
    else {
      results.push(
        error(
          IntegrityCode.DUPLICATE_INSTANCE_KEY,
          { objectKind: "instance", id: instance.id },
          "index",
          `role ${key} already exists (${first}): change the index`,
        ),
      );
    }
  }

  const codes = new Map<string, string>();
  for (const row of index.project.mappings) {
    const first = codes.get(row.code);
    if (first === undefined) codes.set(row.code, row.id);
    else {
      results.push(
        error(
          IntegrityCode.DUPLICATE_ROW_CODE,
          { objectKind: "mapping", id: row.id },
          "code",
          `row code ${row.code} is already used by ${first}`,
        ),
      );
    }
  }

  return results;
}
