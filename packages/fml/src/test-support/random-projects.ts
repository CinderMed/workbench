/**
 * Seeded generator of schema-valid, integrity-valid projects for the grammar-level generative tests
 * (#76). Not a fuzzer of the schema: it builds projects the generator must translate, with the hard
 * cases on purpose (reserved words and FHIR names as column names, leading digits, accents, emoji,
 * names over 64 characters and names that collide after sanitizing; value-map values that collide as
 * rule names or are very long; a long-format table with a code column; references through `via`).
 * The same seed always gives the same project.
 */
import type {
  Coding,
  Column,
  ColumnType,
  Condition,
  FhirValue,
  Instance,
  MappingRow,
  ProjectFile,
  Source,
  ValueMap,
  ValueMapEntry,
} from "@cindermed/model";

/** mulberry32: a small, fast, seedable pseudo-random generator. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Column names that are hard for the element-name rule (ADR-0009). */
export const HARD_COLUMN_NAMES: readonly string[] = [
  "share",
  "default",
  "log",
  "then",
  "id",
  "extension",
  "resourceType",
  "2nd visit",
  "Età",
  "Pain level (0-10)",
  "😀 mood",
  "a b",
  "a-b",
  "a_b",
  "valore misurato",
  "ÄÖÜ",
  `very ${"long ".repeat(16)}name`,
  `very ${"long ".repeat(16)}name 2`,
  "x",
  "X",
];
/** Allowed values that collide as rule names or are very long. */
export const HARD_VALUES: readonly string[] = [
  "Sì",
  "Sí",
  "Si",
  "N/A",
  "N-A",
  "N A",
  "-1",
  "0",
  "1",
  "1.5",
  "a,b",
  `${"lungo ".repeat(14)}A`,
  `${"lungo ".repeat(14)}B`,
  "😀",
  "x y z",
  "Ü",
];

const TYPES: readonly ColumnType[] = [
  "string",
  "integer",
  "decimal",
  "date",
  "dateTime",
  "boolean",
  "categorical",
  "multipleChoice",
];
const RESOURCE_TYPES = [
  "Observation",
  "Condition",
  "Procedure",
  "Encounter",
  "MedicationStatement",
] as const;
const SCT = "http://snomed.info/sct";

export function randomProject(seed: number): ProjectFile {
  const next = random(seed);
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(items.length)];
    if (item === undefined) throw new Error("empty choice");
    return item;
  };
  const chance = (p: number) => next() < p;
  let counter = 0;
  const id = (prefix: string) => `${prefix}_${String(++counter).padStart(4, "0")}`;
  let rowNumber = 0;
  const code = () => `R-${String(++rowNumber).padStart(3, "0")}`;
  const coding = (c: string, display?: string): Coding =>
    display === undefined ? { system: SCT, code: c } : { system: SCT, code: c, display };

  const sources: Source[] = [];
  const valueMaps: ValueMap[] = [];
  const instances: Instance[] = [];
  const mappings: MappingRow[] = [];
  const relations: NonNullable<ProjectFile["sourceRelations"]> = [];
  const typeIndex = new Map<string, number>();
  /** Per table: its key column (every table has one) and its primary role (id from the key only). */
  const keys = new Map<string, { key: Column; primary: Instance }>();

  const valueMapFor = (column: Column, target: ValueMap["target"]): ValueMap => {
    const values = (column.allowedValues ?? []).map((a) => a.code);
    const entries: ValueMapEntry[] = values.map((value, i) => {
      const roll = next();
      if (roll < 0.1) return { sourceValue: value, action: { kind: "skipInstance" } };
      if (roll < 0.18) return { sourceValue: value, action: { kind: "absent" } };
      if (roll < 0.25 && target !== "Quantity.unit") {
        return {
          sourceValue: value,
          action: {
            kind: "setElement",
            set: [{ path: "status", value: { type: "code", value: "unknown" } }],
          },
        };
      }
      const action: ValueMapEntry["action"] = chance(0.2)
        ? { kind: "use", also: [{ path: "priority", value: { type: "code", value: "routine" } }] }
        : { kind: "use" };
      if (target === "code")
        return { sourceValue: value, target: { value: `code${String(i)}` }, action };
      if (target === "boolean")
        return { sourceValue: value, target: { value: i % 2 === 0 }, action };
      return {
        sourceValue: value,
        target: coding(String(100000 + i), chance(0.5) ? `Display ${String(i)}` : undefined),
        action,
      };
    });
    const map: ValueMap = {
      id: id("vm"),
      name: `map${String(valueMaps.length + 1)}`,
      target,
      entries: entries as ValueMap["entries"],
    };
    valueMaps.push(map);
    return map;
  };

  const condition = (columns: readonly Column[], depth = 0): Condition => {
    const column = pick(columns);
    const roll = next();
    if (depth < 2 && roll < 0.15)
      return {
        op: "and",
        conditions: [condition(columns, depth + 1), condition(columns, depth + 1)],
      };
    if (depth < 2 && roll < 0.25)
      return {
        op: "or",
        conditions: [condition(columns, depth + 1), condition(columns, depth + 1)],
      };
    if (depth < 2 && roll < 0.3) return { op: "not", condition: condition(columns, depth + 1) };
    if (roll < 0.55) return { op: "notEmpty", columnId: column.id };
    if (roll < 0.65) return { op: "empty", columnId: column.id };
    if (roll < 0.8) return { op: "equals", columnId: column.id, value: pick(HARD_VALUES) };
    if (roll < 0.9)
      return { op: "in", columnId: column.id, values: [pick(HARD_VALUES), pick(HARD_VALUES)] };
    return { op: "notIn", columnId: column.id, values: [pick(HARD_VALUES)] };
  };

  const newRole = (
    source: Source,
    columns: readonly Column[],
    idColumns: readonly Column[],
    type: string,
  ): Instance => {
    const index = typeIndex.get(type) ?? 0;
    typeIndex.set(type, index + 1);
    const instance: Instance = {
      id: id("ins"),
      resourceType: type,
      index,
      ...(chance(0.8) ? { label: `role ${String(instances.length + 1)}` } : {}),
      sourceId: source.id,
      multiplicity: { kind: "perRow" },
      idRule: {
        parts: [
          { literal: type.toLowerCase().slice(0, 4) },
          ...idColumns.map((c) => ({ columnId: c.id })),
        ] as NonNullable<Instance["idRule"]>["parts"],
        ...(chance(0.2) ? { encoding: "sanitize" as const } : {}),
      },
    };
    if (chance(0.5)) instance.createWhen = condition(columns);
    if (chance(0.5))
      instance.fixedValues = [{ path: "status", value: { type: "code", value: "final" } }];
    if (chance(0.4)) {
      instance.fixedValues = [
        ...(instance.fixedValues ?? []),
        { path: "code", value: { type: "CodeableConcept", coding: coding("12345", "Something") } },
      ];
    }
    instances.push(instance);
    return instance;
  };

  const tableCount = 1 + int(3);
  for (let t = 0; t < tableCount; t++) {
    const long = t === tableCount - 1 && chance(0.5);
    const source: Source = {
      id: id("src"),
      name: `T${String(t)}x${String(int(1000))}`,
      columns: [] as unknown as Source["columns"],
    };
    const key: Column = {
      id: id("col"),
      name: chance(0.3) ? "id" : `key ${String(t)}`,
      dataType: "string",
    };
    const columns: Column[] = [key];
    const names = new Set([key.name]);
    const addColumn = (dataType: ColumnType, name?: string): Column => {
      let n = name ?? (chance(0.6) ? pick(HARD_COLUMN_NAMES) : `col ${String(columns.length)}`);
      while (names.has(n)) n = `${n} ${String(columns.length)}`;
      names.add(n);
      const column: Column = { id: id("col"), name: n, dataType };
      if (dataType === "categorical" || dataType === "multipleChoice") {
        const values = [...new Set(Array.from({ length: 2 + int(5) }, () => pick(HARD_VALUES)))];
        column.allowedValues = values.map((code) => ({ code }));
        if (dataType === "multipleChoice")
          column.multiValue = { encoding: "delimited", separator: "|" };
      }
      if (dataType === "date") column.dateFormat = pick(["dd/MM/yyyy", "yyyy-MM-dd", "MM/yyyy"]);
      if (dataType === "dateTime") column.dateFormat = "dd/MM/yyyy HH:mm";
      if (dataType === "decimal" && chance(0.5)) column.decimalSeparator = ",";
      if (chance(0.15) && dataType !== "categorical" && dataType !== "multipleChoice")
        column.missingValues = ["NA"];
      columns.push(column);
      return column;
    };
    if (long) {
      addColumn("categorical", "itemid");
      addColumn("decimal", "valuenum");
      addColumn("categorical", "valueuom");
    }
    for (let c = 0, n = 2 + int(6); c < n; c++) addColumn(pick(TYPES));
    source.columns = columns as Source["columns"];
    sources.push(source);

    const primary = newRole(source, columns, [key], t === 0 ? "Patient" : pick(RESOURCE_TYPES));
    keys.set(source.id, { key, primary });
    const roles = [primary];
    for (let r = 0, n = int(3); r < n; r++) {
      const extra = pick(columns.filter((c) => c.dataType !== "multipleChoice"));
      const role = newRole(
        source,
        columns,
        extra === key ? [key] : [key, extra],
        pick(RESOURCE_TYPES),
      );
      if (chance(0.3)) {
        role.slices = [
          {
            id: id("slc"),
            path: "component",
            name: "part",
            discriminator: [
              { path: "code", value: { type: "CodeableConcept", coding: coding("777") } },
            ],
          },
        ];
      }
      roles.push(role);
    }

    // Relation to every earlier table, through the key columns.
    for (const earlier of sources.slice(0, -1)) {
      const target = keys.get(earlier.id);
      if (target === undefined) continue;
      relations.push({
        id: id("rel"),
        from: { sourceId: source.id, columnIds: [key.id] },
        to: { sourceId: earlier.id, columnIds: [target.key.id] },
      });
    }

    for (const role of roles) {
      const add = (row: Omit<MappingRow, "id" | "code" | "instanceId">) => {
        const full: MappingRow = {
          id: id("map"),
          code: code(),
          instanceId: role.id,
          ...row,
        };
        if (chance(0.15)) full.condition = condition(columns);
        mappings.push(full);
      };
      if (long && role === primary) {
        const [, item, value, unit] = columns;
        if (item !== undefined && value !== undefined && unit !== undefined) {
          add({
            columnId: item.id,
            path: "code",
            transform: { kind: "valueMap", valueMapId: valueMapFor(item, "CodeableConcept").id },
          });
          add({
            columnId: value.id,
            path: "valueQuantity",
            transform: {
              kind: "quantity",
              unitColumnId: unit.id,
              unitValueMapId: valueMapFor(unit, "Quantity.unit").id,
            },
          });
        }
      }
      for (let r = 0, n = 1 + int(5); r < n; r++) {
        const column = pick(columns);
        const roll = next();
        if (
          (column.dataType === "categorical" ||
            column.dataType === "multipleChoice" ||
            column.dataType === "boolean") &&
          roll < 0.5
        ) {
          if (column.dataType === "boolean") {
            add({ columnId: column.id, path: "valueString", transform: { kind: "copy" } });
            continue;
          }
          const target = pick(["code", "CodeableConcept", "Coding", "boolean"] as const);
          const path =
            target === "code"
              ? "status"
              : target === "boolean"
                ? "valueBoolean"
                : role.slices !== undefined && chance(0.5)
                  ? "component[part].valueCodeableConcept"
                  : "code";
          add({
            columnId: column.id,
            path,
            transform: { kind: "valueMap", valueMapId: valueMapFor(column, target).id },
            ...(column.dataType === "multipleChoice"
              ? { repeat: { kind: "eachValue" as const } }
              : {}),
          });
        } else if ((column.dataType === "integer" || column.dataType === "decimal") && roll < 0.4) {
          add({
            columnId: column.id,
            path: "valueQuantity",
            transform: {
              kind: "quantity",
              unit: { system: "http://unitsofmeasure.org", code: "mg" },
            },
          });
        } else if (roll < 0.6) {
          add({
            columnId: column.id,
            path: pick([
              "note.text",
              "identifier.value",
              "valueString",
              "effectiveDateTime",
              "bodySite.text",
            ]),
            transform: { kind: "copy" },
          });
        } else if (roll < 0.7) {
          add({
            columnId: column.id,
            path: "valueString",
            transform: { kind: "cast", to: "string" },
          });
        } else if (roll < 0.8) {
          const value: FhirValue = chance(0.5)
            ? { type: "uri", value: "http://example.org/id" }
            : { type: "Coding", coding: coding("42") };
          add({
            path: chance(0.5) ? "identifier.system" : "meta.source",
            transform: { kind: "constant", value },
          });
        } else if (role.slices !== undefined && roll < 0.9) {
          add({
            columnId: column.id,
            path: "component[part].valueString",
            transform: { kind: "copy" },
          });
        } else {
          // A reference: to the primary role of this table, or through `via` to an earlier table.
          const earlier = sources.slice(0, -1);
          if (earlier.length > 0 && chance(0.6)) {
            const other = pick(earlier);
            const target = keys.get(other.id)?.primary;
            const relation = relations.find(
              (rel) => rel.from.sourceId === source.id && rel.to.sourceId === other.id,
            );
            if (target !== undefined && relation !== undefined) {
              add({
                path: pick(["subject", "focus", "partOf"]),
                transform: { kind: "reference", targetInstanceId: target.id, via: relation.id },
              });
            }
          } else if (role !== primary) {
            add({
              path: "subject",
              transform: { kind: "reference", targetInstanceId: primary.id, auto: chance(0.5) },
            });
          }
        }
      }
    }
  }

  return {
    $schema: "../mapping-project.schema.json",
    formatVersion: "1.3.0",
    project: {
      id: id("prj"),
      name: `Gen${String(seed)}`,
      fhirVersion: "4.0.1",
      canonicalBase: `http://example.org/fhir/gen${String(seed)}`,
      output: { onInvalidValue: pick(["fail", "report-drop", "reject-row"] as const) },
    },
    sources: sources as ProjectFile["sources"],
    ...(relations.length > 0 ? { sourceRelations: relations } : {}),
    instances,
    mappings,
    valueMaps,
  };
}
