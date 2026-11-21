/**
 * How each path of a table is written, as plain data (#156, ADR-0023). The generator does not read
 * the FHIR definitions: the export resolves every path the generator writes (`pathsToWrite`) with
 * `@cindermed/fhir-defs` and passes, for each segment, the FML element name and, for a choice
 * element, the type the path chooses. `@cindermed/fml` stays independent of `@cindermed/fhir-defs`.
 */
import type { Instance, ProjectFile } from "@cindermed/model";

/** One segment of a path as the generator writes it. */
export interface WrittenSegment {
  /** The FML element name: a choice element by its base name (`value`), any other by its own (`doseQuantity`). */
  readonly name: string;
  /** For a choice element only: the type the path chooses (`string`, `dateTime`, `Age`, `Quantity`). */
  readonly choiceType?: string;
}

/** Every path of a table's roles as written, by `pathKey(role id, path)`. */
export type WrittenPaths = ReadonlyMap<string, readonly WrittenSegment[]>;

/** The key of a path in `WrittenPaths`: the role and the project path (`component[nrs].valueInteger`). */
export const pathKey = (instanceId: string, path: string): string => `${instanceId} ${path}`;

/**
 * Every path the generator writes for a role: its rows' paths, its fixed values, the paths a value
 * map used by its rows sets (`setElement`, `use.also`; a quantity's unit value map too), and its
 * slices' discriminators
 * (`component[nrs].code`). The export resolves exactly these.
 */
export function pathsToWrite(project: ProjectFile, instance: Instance): string[] {
  const paths = new Set<string>();
  for (const fixed of instance.fixedValues ?? []) paths.add(fixed.path);
  for (const slice of instance.slices ?? [])
    for (const d of slice.discriminator) paths.add(`${slice.path}[${slice.name}].${d.path}`);
  const maps = new Map(project.valueMaps.map((m) => [m.id, m]));
  for (const row of project.mappings) {
    if (row.instanceId !== instance.id) continue;
    paths.add(row.path);
    const t = row.transform;
    // A value map, or the unit value map of a quantity: both can set elements of the role.
    const mapId =
      t.kind === "valueMap" ? t.valueMapId : t.kind === "quantity" ? t.unitValueMapId : undefined;
    if (mapId === undefined) continue;
    for (const entry of maps.get(mapId)?.entries ?? []) {
      const action = entry.action;
      if (action.kind === "setElement") for (const set of action.set) paths.add(set.path);
      if (action.kind === "use") for (const set of action.also ?? []) paths.add(set.path);
    }
  }
  return [...paths];
}
