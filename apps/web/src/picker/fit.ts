/**
 * How each element of the path picker fits the row being placed (specification, "Type
 * compatibility in the grid", point 1), with the same type checks as validation
 * (`checkRowTypes`, ADR-0015).
 *
 * A row with a chosen transform is checked as it is: an element its transform cannot write is
 * greyed and cannot be chosen. A row that is still a copy (as the grid creates every new row, the
 * transform being set after the element) is checked against every transform its column can take:
 * an element none of them can write is greyed; one that only another transform can write can be
 * chosen, and the picker says which transforms.
 */
import { type FhirDefinitions, checkRowTypes, resolvePath } from "@cindermed/fhir-defs";
import type { Column, MappingRow, ProjectFile, Transform, ValueMap } from "@cindermed/model";
import { castTypes } from "../transforms/transform-form";

export type Fit =
  | { readonly kind: "ok" }
  /** Can be chosen; the row gives a warning there. */
  | { readonly kind: "warn"; readonly message: string }
  /** Can be chosen; the row then needs one of these transforms. */
  | { readonly kind: "needs"; readonly transforms: readonly Transform["kind"][] }
  /** Cannot be chosen. */
  | { readonly kind: "blocked"; readonly message: string };

const OK: Fit = { kind: "ok" };

/** Fields of findings that do not depend on the element: wrong wherever the row goes. */
const ROW_FIELDS = new Set(["columnId", "transform.to"]);

/** Value maps of each target, standing for the maps a column could get (module 8). */
const MAP_TARGETS = ["code", "Coding", "CodeableConcept", "boolean"] as const;
const mapOf = (target: (typeof MAP_TARGETS)[number]): ValueMap => ({
  id: `fit-${target}`,
  name: `a value map to ${target}`,
  target,
  // Never read: only the map's target decides the fit.
  entries: [{ sourceValue: "", action: { kind: "use" } }],
});

/** The transforms a copy of this column could become (specification, transforms table). */
function alternatives(column: Column): Transform[] {
  const type = column.dataType;
  const found: Transform[] = castTypes(column).map((to) => ({ kind: "cast", to }));
  if (type === "integer" || type === "decimal")
    found.push({ kind: "quantity", unit: { system: "http://unitsofmeasure.org", code: "1" } });
  if (type === "string" || type === "categorical" || type === "integer")
    for (const as of ["Coding", "CodeableConcept"] as const)
      found.push({ kind: "coding", system: "urn:fit", as });
  if (type === "categorical" || type === "multipleChoice" || type === "boolean")
    for (const target of MAP_TARGETS)
      found.push({ kind: "valueMap", valueMapId: mapOf(target).id });
  return found;
}

/** The fit of a path for a row: computed once per path. */
export function fitter(
  defs: FhirDefinitions,
  ref: string,
  resourceType: string,
  project: ProjectFile,
  row: MappingRow,
): (path: string) => Fit {
  const columns = new Map(project.sources.flatMap((s) => s.columns.map((c) => [c.id, c])));
  const context = {
    columns,
    valueMaps: new Map([
      ...project.valueMaps.map((v): [string, ValueMap] => [v.id, v]),
      ...MAP_TARGETS.map((t): [string, ValueMap] => [mapOf(t).id, mapOf(t)]),
    ]),
  };
  const column = row.columnId === undefined ? undefined : columns.get(row.columnId);
  const others = row.transform.kind === "copy" && column !== undefined ? alternatives(column) : [];
  const cache = new Map<string, Fit>();

  return (path) => {
    const known = cache.get(path);
    if (known !== undefined) return known;
    const resolved = resolvePath(defs, ref, path);
    let fit: Fit = OK; // A path that does not resolve here is left to validation.
    if (resolved.ok) {
      const check = (transform: Transform) =>
        checkRowTypes(defs, context, { ...row, path, transform }, resourceType, resolved.value);
      const findings = check(row.transform);
      const errors = findings.filter((f) => f.severity === "error");
      // Errors on the element, not on the row alone (a column or conversion that is wrong anywhere).
      const onElement = errors.filter((f) => !ROW_FIELDS.has(f.field));
      const [error] = onElement;
      if (error === undefined) {
        const other = findings[0];
        fit = other === undefined ? OK : { kind: "warn", message: other.message };
      } else {
        const tried = others.map((t) => ({
          t,
          errors: check(t).filter((f) => f.severity === "error"),
        }));
        const kinds = [...new Set(tried.filter((x) => x.errors.length === 0).map((x) => x.t.kind))];
        // When the copy only needs another transform, say why that one fails too.
        const why = error.code === "TYPE_NEEDS_TRANSFORM" ? (tried[0]?.errors[0] ?? error) : error;
        fit =
          kinds.length > 0
            ? { kind: "needs", transforms: kinds }
            : { kind: "blocked", message: why.message };
      }
    }
    cache.set(path, fit);
    return fit;
  };
}
