/**
 * ConceptMaps (G3): one per value map, exported as documentation of the mapping decisions. The
 * StructureMap does not use them (one rule per value, no `translate()`), so they never affect the
 * conversion. Value maps with a `boolean` target produce no ConceptMap: they map local words to
 * true/false, not codes, and the CSV/XLSX export documents them (H1).
 *
 * - `id` and the end of `url` are the value map's name; `name` is the same with a capital first
 *   letter; `version` is the logical model's (the project format version until #83); `status`
 *   is `draft`; `description` only when the value map has one (FHIR does not allow empty strings).
 * - Only `use` entries are listed (#119 adds the deliberately unmapped ones), grouped by target
 *   system and version in sorted order; a `code` map has one group without a target system.
 * - R4: `target: [{ code, equivalence: "equivalent", display? }]`, `group.targetVersion`.
 *   R5: `relationship: "equivalent"` instead of `equivalence`, the version in `group.target`
 *   (`system|version`).
 */
import type { ProjectFile, ValueMap, ValueMapEntry } from "@cindermed/model";

export interface ConceptMapOptions {
  readonly fhirRelease: "R4" | "R5";
}

interface TargetJson {
  readonly code: string;
  readonly equivalence?: "equivalent";
  readonly relationship?: "equivalent";
  readonly display?: string;
}

interface ElementJson {
  readonly code: string;
  readonly display?: string;
  readonly target: readonly TargetJson[];
}

interface GroupJson {
  readonly element: readonly ElementJson[];
  readonly target?: string;
  readonly targetVersion?: string;
}

export interface ConceptMapJson {
  readonly resourceType: "ConceptMap";
  readonly id: string;
  readonly url: string;
  readonly version: string;
  readonly name: string;
  readonly status: "draft";
  readonly description?: string;
  readonly group: readonly GroupJson[];
}

const nonEmpty = (text: string | undefined): string | undefined => (text === "" ? undefined : text);

interface Mapped {
  readonly entry: ValueMapEntry;
  readonly system: string;
  readonly version: string;
  readonly code: string;
  readonly display?: string;
}

function mapped(entry: ValueMapEntry): Mapped | undefined {
  const target = entry.target;
  if (entry.action.kind !== "use" || target === undefined) return undefined;
  if ("value" in target) {
    return typeof target.value === "string"
      ? { entry, system: "", version: "", code: target.value }
      : undefined;
  }
  const display = nonEmpty(target.display);
  return {
    entry,
    system: target.system,
    version: target.version ?? "",
    code: target.code,
    ...(display === undefined ? {} : { display }),
  };
}

/** The ConceptMap of a value map, or `undefined` for a value map with a boolean target. */
export function conceptMap(
  project: ProjectFile,
  valueMap: ValueMap,
  options: ConceptMapOptions,
): ConceptMapJson | undefined {
  if (valueMap.target === "boolean") return undefined;
  const entries = valueMap.entries.map(mapped).filter((m): m is Mapped => m !== undefined);
  const keys = [...new Set(entries.map((m) => `${m.system}|${m.version}`))].sort();
  const group = keys.map((key): GroupJson => {
    const members = entries.filter((m) => `${m.system}|${m.version}` === key);
    const [system = "", version = ""] = key.split("|");
    const element = members.map((m): ElementJson => {
      const label = nonEmpty(m.entry.sourceLabel);
      const relation =
        options.fhirRelease === "R4"
          ? { equivalence: "equivalent" as const }
          : { relationship: "equivalent" as const };
      return {
        code: m.entry.sourceValue,
        ...(label === undefined ? {} : { display: label }),
        target: [
          { code: m.code, ...relation, ...(m.display === undefined ? {} : { display: m.display }) },
        ],
      };
    });
    if (system === "") return { element };
    if (options.fhirRelease === "R5") {
      return { element, target: version === "" ? system : `${system}|${version}` };
    }
    return { element, target: system, ...(version === "" ? {} : { targetVersion: version }) };
  });
  const description = nonEmpty(valueMap.description);
  return {
    resourceType: "ConceptMap",
    id: valueMap.name,
    url: `${project.project.canonicalBase}/ConceptMap/${valueMap.name}`,
    version: project.formatVersion,
    name: `${valueMap.name.charAt(0).toUpperCase()}${valueMap.name.slice(1)}`,
    status: "draft",
    ...(description === undefined ? {} : { description }),
    group,
  };
}

/** The ConceptMaps of every value map of the project, in project order (boolean maps skipped). */
export function conceptMaps(project: ProjectFile, options: ConceptMapOptions): ConceptMapJson[] {
  return project.valueMaps
    .map((valueMap) => conceptMap(project, valueMap, options))
    .filter((map): map is ConceptMapJson => map !== undefined);
}
