/**
 * Writes the real FHIR R4 definition index of the Metastra example into apps/web/.fhir-index,
 * where the dev server serves it to the local mode (ADR-0021). The core package comes from the
 * shared FHIR package cache (~/.fhir/packages), downloaded once and checked by its SHA-256.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const metastraProject = `${repoRoot}fixtures/fml-examples/metastra/project.json`;

export default function globalSetup(): void {
  execFileSync(
    process.execPath,
    [
      `${repoRoot}apps/cli/dist/bin.js`,
      "fhir-index",
      metastraProject,
      "--out",
      `${repoRoot}apps/web/.fhir-index`,
    ],
    { stdio: "inherit" },
  );
}
