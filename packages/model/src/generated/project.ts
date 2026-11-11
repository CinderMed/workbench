// Generated from src/schemas/mapping-project.schema.json by `pnpm codegen` (tooling/codegen). Do not edit:
// change the schema (a contract, see CLAUDE.md) and regenerate.

/**
 * Stable internal identifier, generated automatically (e.g. ULID). It never changes, not even when the object is renamed.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Id".
 */
export type Id = string;
/**
 * Free-text semantic description. Used by people and by the future AI assistant (module I).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Description".
 */
export type Description = string;
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Canonical".
 */
export type Canonical = string;
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string;
/**
 * Machine-readable name (columns, tables, sections): no leading or trailing spaces.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Name".
 */
export type Name = string;
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ColumnType".
 */
export type ColumnType =
  | "string"
  | "integer"
  | "decimal"
  | "date"
  | "dateTime"
  | "boolean"
  | "categorical"
  | "multipleChoice";
/**
 * Review status (A5).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Status".
 */
export type Status = "todo" | "draft" | "toReview" | "approved" | "notMappable" | "excluded";
/**
 * How many resources the role produces FOR EACH converted RECORD.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Multiplicity".
 */
export type Multiplicity =
  | {
      /**
       * One resource per record.
       */
      kind: "perRow";
    }
  | {
      /**
       * One resource per combination of key columns (e.g. patient + visit date), even when several records share it.
       */
      kind: "perGroup";
      /**
       * @minItems 1
       */
      groupBy: [Id, ...Id[]];
    }
  | {
      /**
       * One resource for each selected value of a multiple-choice column (V2).
       */
      kind: "perValue";
      columnId: Id;
    };
/**
 * Condition built by the guided editor (C4). 'expression' is reserved for the technical role (D6).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Condition".
 */
export type Condition =
  | {
      op: "notEmpty" | "empty";
      columnId: Id;
    }
  | {
      op: "equals" | "notEquals";
      columnId: Id;
      value: string;
    }
  | {
      op: "in" | "notIn";
      columnId: Id;
      /**
       * @minItems 1
       */
      values: [string, ...string[]];
    }
  | {
      op: "and" | "or";
      /**
       * @minItems 2
       */
      conditions: [Condition, Condition, ...Condition[]];
    }
  | {
      op: "not";
      condition: Condition;
    }
  | {
      op: "expression";
      language: "fhirpath";
      expression: string;
    };
/**
 * Typed FHIR value for constants and fixed values.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "FhirValue".
 */
export type FhirValue =
  | {
      type: "string" | "code" | "boolean" | "integer" | "decimal" | "date" | "dateTime" | "uri";
      value: string | number | boolean;
    }
  | {
      type: "Coding" | "CodeableConcept";
      coding: Coding;
      text?: string;
    }
  | {
      type: "Quantity";
      value?: number;
      unit: Coding;
    };
/**
 * Path inside the role, without the resource type, with optional named slices. E.g. 'valueCodeableConcept', 'component[nrs].valueInteger', 'verificationStatus'. Rule: without a slice, all rows that touch a repeating element write into the SAME repetition (the first); several repetitions need a named slice.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ElementPath".
 */
export type ElementPath = string;
/**
 * Guided transforms (D5) and references (F1–F3).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Transform".
 */
export type Transform =
  | {
      kind: "copy";
    }
  | {
      kind: "cast";
      to: "string" | "integer" | "decimal" | "boolean" | "date" | "dateTime";
      inputFormat?: string;
    }
  | {
      kind: "constant";
      value: FhirValue;
    }
  | {
      kind: "valueMap";
      valueMapId: Id;
    }
  | {
      kind: "quantity";
      unit?: Coding;
      unitColumnId?: Id;
      unitValueMapId?: Id;
    }
  | {
      kind: "concat";
      /**
       * @minItems 2
       */
      columnIds: [Id, Id, ...Id[]];
      separator?: string;
    }
  | {
      kind: "reference";
      targetInstanceId: Id;
      /**
       * true = generated from the context (F2).
       */
      auto?: boolean;
      /**
       * Table relation to use when the target role is in another table (B11).
       */
      via?: Id;
    }
  | {
      kind: "expression";
      language: "fml" | "fhirpath";
      expression: string;
    };
/**
 * Action for a value (E6).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ValueAction".
 */
export type ValueAction =
  | {
      kind: "use";
      also?: SetElement[];
    }
  | {
      /**
       * Do not create the role's resource.
       */
      kind: "skipInstance";
    }
  | {
      kind: "setElement";
      /**
       * @minItems 1
       */
      set: [SetElement, ...SetElement[]];
    }
  | {
      /**
       * Treat as a missing value: the element is not written.
       */
      kind: "absent";
    };

/**
 * Native format of a tabular → FHIR mapping project. It is the source of truth from which the grid, the FML (StructureMap, logical model, ConceptMap) and the CSV export are generated. Every reference between objects uses the stable internal 'id', never the visible names.
 */
export interface ProjectFile {
  $schema?: string;
  /**
   * Version of this file format (semver). The major changes only with incompatible changes.
   */
  formatVersion: string;
  project: Project;
  /**
   * Source tables. The MVP UI handles one; the format allows several (B11).
   *
   * @minItems 1
   */
  sources: [Source, ...Source[]];
  /**
   * Key-based links between tables (B11). Empty with a single table.
   */
  sourceRelations?: SourceRelation[];
  /**
   * Roles of FHIR resources in the template (e.g. Condition[1] · osteoporosis). They are not real resources.
   */
  instances: Instance[];
  /**
   * Mapping rows: column (or constant) → element of a role.
   */
  mappings: MappingRow[];
  /**
   * Value maps, reusable by several rows. Each one becomes a ConceptMap.
   */
  valueMaps: ValueMap[];
  /**
   * Reusable groups of roles and rows with parameters (C7, V2).
   */
  templates?: Template[];
  /**
   * Free space for data of external tools (e.g. conversion module, AI assistant). Ignored by the FML generator.
   */
  extensions?: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Project".
 */
export interface Project {
  id: Id;
  name: string;
  description?: Description;
  /**
   * Target FHIR version (A1).
   */
  fhirVersion: "4.0.1" | "5.0.0";
  /**
   * Additional FHIR packages (IGs, profiles) besides the core.
   */
  packages?: {
    name: string;
    version: string;
  }[];
  /**
   * Base of the generated canonical URLs (StructureMap, StructureDefinition, ConceptMap, CodeSystem).
   */
  canonicalBase: Canonical;
  /**
   * The API key is NOT stored in the file: it stays on the server.
   */
  terminology?: {
    provider?: "bioportal" | "fhirTerminologyServer" | "none";
    /**
     * Searchable systems. For now only free-licence terminologies.
     */
    allowedSystems?: Canonical[];
  };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  /**
   * Shape of the conversion output. Each source record produces ONE Bundle; resources shared by several records (perGroup) merge on the server thanks to deterministic ids and PUT. With PUT, if two records write different fields of the same resource, the last one wins: the application reports it.
   */
  output?: {
    bundleType?: "transaction";
    requestMethod?: "PUT";
    /**
     * Absolute base for Bundle.entry.fullUrl ({base}/{Type}/{id}), needed so that relative references resolve inside the Bundle. Usually the URL of the target FHIR server; canonicalBase is used when absent.
     */
    fullUrlBase?: Canonical;
    /**
     * What the conversion does with a value that cannot be converted to the column's type (e.g. 'abc' in an integer column, '31/02/2023' in a date column). fail: the conversion stops at the first such value and reports it; report-drop: the value is omitted and reported; reject-row: the whole row is discarded and reported. Written into every normalization specification.
     */
    onInvalidValue?: "fail" | "report-drop" | "reject-row";
  };
}
/**
 * An input table (B1–B6).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  id: Id;
  name: Name;
  description?: Description;
  /**
   * Columns that identify a record (e.g. patient_id). Used for deterministic ids and for links between tables.
   */
  rowKey?: Id[];
  import?: ImportProfile;
  sections?: {
    id: Id;
    name: string;
    description?: Description;
    order?: number;
  }[];
  /**
   * @minItems 1
   */
  columns: [Column, ...Column[]];
}
/**
 * Import wizard settings (B2, B3), reusable on other sheets.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ImportProfile".
 */
export interface ImportProfile {
  fileName?: string;
  sheet?: string;
  fileKind?: "data" | "dictionary";
  delimiter?: string;
  encoding?: string;
  headerRow?: number;
  skipRows?: number;
  /**
   * Only for fileKind = dictionary: role of each column of the file (key = header or letter).
   */
  columnRoles?: {
    [k: string]:
      | "name"
      | "label"
      | "description"
      | "dataType"
      | "valueLabel"
      | "valueCode"
      | "section"
      | "ignore";
  };
  continuationRows?: "allowedValuesOfPrevious" | "ignore";
  /**
   * Translation of the file's types into workbench types (e.g. 'list, single choice' → categorical).
   */
  typeRules?: {
    [k: string]: ColumnType;
  };
  importedAt?: Timestamp;
}
/**
 * A source variable (B4–B6).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Column".
 */
export interface Column {
  id: Id;
  /**
   * Current name, possibly corrected by hand.
   */
  name: Name;
  /**
   * Name as it appears in the data file, if different from 'name' (alias used in the FML). E.g. 'obs_bloodt_lymphocites_spec'.
   */
  originalName?: string;
  label?: string;
  description?: Description;
  sectionId?: Id;
  order?: number;
  dataType: ColumnType;
  dateFormat?: string;
  /**
   * Only for dataType = decimal: decimal separator used in the data file (e.g. ',' for '11,20'). Inside the platform decimals always use '.'; the normalization converts at the border.
   */
  decimalSeparator?: "." | ",";
  /**
   * Fixed unit of the column, if known (e.g. kg).
   */
  unit?: Coding;
  /**
   * Values to treat as missing (e.g. 'NA', '-1').
   */
  missingValues?: string[];
  allowedValues?: {
    /**
     * Value as it appears in the data (e.g. '1', '-1', 'Male').
     */
    code: string;
    label?: string;
    description?: Description;
  }[];
  provenance?: Provenance;
  review?: Review;
  /**
   * Only for dataType = multipleChoice: how the multiple value appears in the data.
   */
  multiValue?:
    | {
        /**
         * Several codes in the same cell, e.g. '1,3,5'.
         */
        encoding: "delimited";
        separator: string;
      }
    | {
        /**
         * One 0/1 column per value, e.g. var___1, var___2 (B9, V2).
         */
        encoding: "expanded";
        /**
         * @minItems 1
         */
        columns: [
          {
            value: string;
            originalName: string;
          },
          ...{
            value: string;
            originalName: string;
          }[],
        ];
      };
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Coding".
 */
export interface Coding {
  system: Canonical;
  version?: string;
  code: string;
  display?: string;
  /**
   * Result of the terminology server check (E4). 'manual' = entered by hand, cannot be checked (e.g. SNOMED CT without a licence).
   */
  verification?: {
    status: "verified" | "displayMismatch" | "notFound" | "manual";
    checkedAt?: Timestamp;
    serverDisplay?: string;
  };
}
/**
 * Who created the object. 'ai' is reserved for the assistant (module I): its proposals enter as 'draft'.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Provenance".
 */
export interface Provenance {
  kind: "user" | "import" | "ai";
  /**
   * E.g. name of the import profile or of the AI model.
   */
  detail?: string;
  /**
   * User who accepted an AI proposal.
   */
  acceptedBy?: string;
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Review".
 */
export interface Review {
  status: Status;
  comments?: Comment[];
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Comment".
 */
export interface Comment {
  id: Id;
  author: string;
  createdAt: Timestamp;
  text: string;
  replyTo?: Id;
  resolved?: boolean;
}
/**
 * Link between two tables (e.g. MotuKnee.AnonymousID → MotuPatient.AnonymousID).
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "SourceRelation".
 */
export interface SourceRelation {
  id: Id;
  from: ColumnSet;
  to: ColumnSet;
  cardinality?: "manyToOne" | "oneToOne";
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ColumnSet".
 */
export interface ColumnSet {
  sourceId: Id;
  /**
   * @minItems 1
   */
  columnIds: [Id, ...Id[]];
}
/**
 * Role of a FHIR resource in the template (C1–C7). The visible key is resourceType[index], e.g. Condition[1].
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Instance".
 */
export interface Instance {
  id: Id;
  resourceType: string;
  /**
   * Generated index, unique per resourceType in the project.
   */
  index: number;
  label?: string;
  description?: Description;
  profile?: Canonical;
  /**
   * Table the role reads its fields from.
   */
  sourceId: Id;
  multiplicity: Multiplicity;
  /**
   * Context roles used to fill subject/patient/encounter automatically (C3, F2).
   */
  context?: {
    patientInstanceId?: Id;
    encounterInstanceId?: Id;
  };
  /**
   * Creation condition (C4). Single rule: the resource is created if createWhen is true (absent = always) AND no column mapped to the role has, in the record, a value whose action is skipInstance.
   */
  createWhen?: Condition;
  /**
   * Rule for the deterministic id of the generated resource (C6). 'literal' parts stay readable; column values are encoded according to 'encoding'. Final id: [A-Za-z0-9-.], at most 64 characters (checked by the application).
   */
  idRule?: {
    /**
     * @minItems 1
     */
    parts: [
      (
        | {
            literal: string;
          }
        | {
            columnId: Id;
          }
      ),
      ...(
        | {
            literal: string;
          }
        | {
            columnId: Id;
          }
      )[],
    ];
    separator?: string;
    /**
     * hash = SHA-256 of the column values (optionally keyed with a server-side secret), truncated to hashLength hex characters; sanitize = readable values with disallowed characters replaced by '-'.
     */
    encoding?: "hash" | "sanitize";
    hashLength?: number;
  };
  /**
   * Named repetitions of an element (D4), e.g. component[nrs].
   */
  slices?: Slice[];
  /**
   * Constant values of the role (C5), e.g. status = final, code = SCT 279039007.
   */
  fixedValues?: {
    path: ElementPath;
    value: FhirValue;
  }[];
  templateId?: Id;
  provenance?: Provenance;
  review?: Review;
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Slice".
 */
export interface Slice {
  id: Id;
  /**
   * Repeated element
   */
  path: string;
  name: string;
  /**
   * Fixed values that identify the repetition (e.g. component.code).
   *
   * @minItems 1
   */
  discriminator: [
    {
      path: string;
      value: FhirValue;
    },
    ...{
      path: string;
      value: FhirValue;
    }[],
  ];
}
/**
 * A grid row (D1–D8). No columnId = constant value or reference.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "MappingRow".
 */
export interface MappingRow {
  id: Id;
  /**
   * Generated visible code (e.g. R-031), used in FML rule names and in error messages.
   */
  code: string;
  columnId?: Id;
  instanceId: Id;
  path: ElementPath;
  transform: Transform;
  /**
   * Extra condition that applies to this row only.
   */
  condition?: Condition;
  notes?: string;
  provenance?: Provenance;
  review?: Review;
  /**
   * For multipleChoice columns: 'eachValue' writes one repetition of the element for each selected value (e.g. Procedure.bodySite for each level). The target element must be repeating.
   */
  repeat?: {
    kind: "eachValue";
  };
}
/**
 * Map from source values to codes (E1–E6). It becomes a ConceptMap.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ValueMap".
 */
export interface ValueMap {
  id: Id;
  name: string;
  description?: Description;
  target: "CodeableConcept" | "Coding" | "code" | "boolean" | "Quantity.unit";
  /**
   * @minItems 1
   */
  entries: [ValueMapEntry, ...ValueMapEntry[]];
  provenance?: Provenance;
  review?: Review;
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "ValueMapEntry".
 */
export interface ValueMapEntry {
  sourceValue: string;
  sourceLabel?: string;
  /**
   * Required when action.kind = use.
   */
  target?:
    | Coding
    | {
        value: string | boolean;
      };
  action: ValueAction;
  description?: Description;
}
/**
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "SetElement".
 */
export interface SetElement {
  path: ElementPath;
  value: FhirValue;
}
/**
 * Reusable group of roles and rows (C7, V2). Applications substitute the parameters, e.g. suffix '_2' for LastOverview.
 *
 * This interface was referenced by `ProjectFile`'s JSON-Schema
 * via the `definition` "Template".
 */
export interface Template {
  id: Id;
  name: string;
  description?: Description;
  /**
   * @minItems 1
   */
  instanceIds: [Id, ...Id[]];
  parameters?: {
    name: string;
    kind: "columnSuffix" | "columnPrefix" | "sourceId" | "contextEncounter";
  }[];
  applications?: {
    id: Id;
    label?: string;
    arguments: {
      [k: string]: string;
    };
  }[];
}
