// Nightly (#76): the HL7 engine compiles the maps of 20 of the 300 seeded random projects of the
// grammar-level generative tests (same builder, seeds 1–20), so engine rejections show up before
// the compilation-level tests of module 3. Each compiled StructureMap must also equal the one our
// builder writes, apart from `status`. Runs only when FML_GENERATIVE_COMPILE=1 and VALIDATOR are set
// (nightly.yml); outputs go to .tmp/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  generateMap,
  logicalModel,
  planTable,
  printMap,
  toStructureMap,
} from "../packages/fml/src/index.js";
import { randomProject } from "../packages/fml/src/test-support/random-projects.js";

const root = resolve(import.meta.dirname, "..");
const work = join(root, ".tmp", "generative-compile");
const validator = process.env["VALIDATOR"];
const enabled = process.env["FML_GENERATIVE_COMPILE"] === "1" && validator !== undefined;
const SEEDS = 20;
/**
 * Seeds the HL7 engine is known to reject, with the issue that tracks each one. A known failure
 * must keep failing: one that starts passing fails the job too, so this list cannot go stale.
 * Empty since #134 (seeds 4, 14, 17 and 20) was fixed.
 */
const KNOWN_FAILURES: ReadonlyMap<number, string> = new Map<number, string>();

describe.runIf(enabled)("generative: the HL7 engine compiles the generated maps", () => {
  // In beforeAll, not in the describe body: the body runs at collection even when the suite is
  // skipped, so a parallel `pnpm test` would delete the folder of a running nightly job.
  beforeAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
  const check = (seed: number) => {
    const project = randomProject(seed);
    for (const source of project.sources) {
      const planned = planTable(project, source.id);
      if (!planned.ok) throw new Error(JSON.stringify(planned.results));
      const map = generateMap(project, planned.value);
      if (!map.ok) throw new Error(JSON.stringify(map.results));
      const ig = join(work, `seed-${String(seed)}`, source.name);
      mkdirSync(ig, { recursive: true });
      const model = logicalModel(project, planned.value);
      writeFileSync(join(ig, `${map.value.name}.map`), printMap(map.value));
      writeFileSync(
        join(ig, `StructureDefinition-${model.name}.json`),
        JSON.stringify(model, null, 2),
      );
      const output = join(work, `seed-${String(seed)}-${source.name}.json`);
      execFileSync(
        "java",
        [
          "-jar",
          validator ?? "",
          "compile",
          map.value.url,
          "-version=4.0.1",
          "-tx=n/a",
          `-ig=${ig}`,
          `-output=${output}`,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      const compiled = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
      const ours = toStructureMap(map.value, { fhirRelease: "R4" }) as unknown as Record<
        string,
        unknown
      >;
      delete ours["status"];
      expect(compiled).toEqual(ours);
    }
  };
  for (const seed of seeds) {
    const known = KNOWN_FAILURES.get(seed);
    if (known === undefined)
      it(`seed ${String(seed)}`, () => {
        check(seed);
      }, 300_000);
    else
      it.fails(
        `seed ${String(seed)} (known failure, ${known})`,
        () => {
          check(seed);
        },
        300_000,
      );
  }
});
