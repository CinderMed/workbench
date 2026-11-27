// Generated from src/schemas/manifest.schema.json by `pnpm codegen` (tooling/codegen). Do not edit:
// change the schema (a contract, see CLAUDE.md) and regenerate.

/**
 * Describes the content of the FML package exported by the workbench (G7) and everything the conversion module needs to run it without knowing the workbench: tables, load order, files with SHA-256 digests, versions and verification results.
 */
export interface ExportManifest {
  $schema?: string;
  /**
   * Version of this manifest format (semver). A reader of 1.x accepts every older 1.y; the major changes only with incompatible changes.
   */
  formatVersion: string;
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
   * The FHIR packages the mapping was checked against: the core package first, then the project's packages and their dependencies, by name (format 1.1.0: every package loaded, #146).
   */
  packages?: {
    name: string;
    version: string;
    /**
     * Format 1.1.0 (#146): SHA-256 (hex) of the package tarball as published by the registry, so the conversion module can check it runs against the same definitions. The export always writes it.
     */
    sha256?: string;
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
