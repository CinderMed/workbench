// Generated from src/schemas/manifest.schema.json by `pnpm codegen` (tooling/codegen). Do not edit:
// change the schema (a contract, see CLAUDE.md) and regenerate.

/**
 * Describes the content of the FML package exported by the workbench (G7) and everything the conversion module needs to run it without knowing the workbench: tables, load order, files with SHA-256 digests, versions and verification results.
 */
export interface ExportManifest {
  $schema?: string;
  formatVersion: "1.0.0";
  package: {
    name: string;
    /**
     * Package version (e.g. from the mapping release, A8).
     */
    version: string;
    createdAt: string;
    generator: {
      name: string;
      version: string;
    };
  };
  project: {
    id: string;
    name: string;
    /**
     * Version of the project file schema (e.g. 1.2.0).
     */
    formatVersion: string;
    /**
     * Copy of the project file included in the package.
     */
    file: string;
  };
  fhirVersion: "4.0.1" | "5.0.0";
  /**
   * Required FHIR packages (core + any IGs).
   */
  packages?: {
    name: string;
    version: string;
  }[];
  output: {
    bundleType: "transaction";
    requestMethod: "PUT";
    fullUrlBase: string;
  };
  /**
   * Order in which to convert and load the tables: each table after the ones it references (topological sort of the relations; ties in alphabetical order). Tables in the same group do not depend on each other.
   */
  loadOrder?: [string, ...string[]][];
  /**
   * @minItems 1
   */
  tables: [
    {
      source: string;
      dependsOn?: string[];
      structureMap: {
        url: string;
        fml: string;
        json: string;
      };
      logicalModel: {
        url: string;
        file: string;
      };
      /**
       * File conforming to normalization.schema.json.
       */
      normalization: string;
      /**
       * Roles created by the table (Type[n] · label), for human reading.
       */
      creates?: string[];
    },
    ...{
      source: string;
      dependsOn?: string[];
      structureMap: {
        url: string;
        fml: string;
        json: string;
      };
      logicalModel: {
        url: string;
        file: string;
      };
      /**
       * File conforming to normalization.schema.json.
       */
      normalization: string;
      /**
       * Roles created by the table (Type[n] · label), for human reading.
       */
      creates?: string[];
    }[],
  ];
  /**
   * Value maps exported as documentation: the FML does not use them during conversion.
   */
  conceptMaps?: {
    url: string;
    file: string;
  }[];
  /**
   * Result of the checks run by the workbench before export (G10).
   */
  verification?: {
    grammar?: {
      source?: string;
      commit?: string;
      result: "passed" | "failed" | "skipped";
    };
    compile?: {
      engine?: string;
      version?: string;
      result: "passed" | "failed" | "skipped";
    };
    checkedAt?: string;
  };
  /**
   * All package files (except the manifest) with SHA-256 digests, to check that nothing was modified.
   */
  files: {
    path: string;
    sha256: string;
    mediaType?: string;
  }[];
}
