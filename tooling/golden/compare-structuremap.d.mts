// Types of compare-structuremap.mjs, for the tooling tests.
export declare const ENGINE_RESOURCE_DEFINITION: string;
export declare const R5_ENGINE_DEFECTS: Readonly<Record<string, string>>;
export declare function compareStructureMaps(
  engine: unknown,
  ours: unknown,
  fhirVersion: string,
): { readonly differences: string[]; readonly setAside: string[] };
