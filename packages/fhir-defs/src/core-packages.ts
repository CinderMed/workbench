/**
 * The core package of each supported FHIR version, with the SHA-256 of its tarball as published
 * on packages.fhir.org (ADR-0013). A loader that downloads a core package must check this digest.
 */
export interface CorePackage {
  readonly fhirVersion: string;
  readonly id: string;
  readonly version: string;
  /** SHA-256 (hex) of the package tarball (`.tgz`). */
  readonly tarballSha256: string;
}

export const CORE_PACKAGES: readonly CorePackage[] = [
  {
    fhirVersion: "4.0.1",
    id: "hl7.fhir.r4.core",
    version: "4.0.1",
    tarballSha256: "ebd7731df7d36b5b7d39d5fb6c9d77b44bb7fe5742f1a2e87f164738c3289d44",
  },
  {
    fhirVersion: "5.0.0",
    id: "hl7.fhir.r5.core",
    version: "5.0.0",
    tarballSha256: "74b27cd1bfce9e80eaceac431edf230b0945a443564fbf5512f82e5fa50a80d4",
  },
];

/** The core package of a FHIR version, if the workbench supports it. */
export function corePackage(fhirVersion: string): CorePackage | undefined {
  return CORE_PACKAGES.find((p) => p.fhirVersion === fhirVersion);
}

/** The core package with this id and version, if it is one. */
export function findCorePackage(id: string, version: string): CorePackage | undefined {
  return CORE_PACKAGES.find((p) => p.id === id && p.version === version);
}
