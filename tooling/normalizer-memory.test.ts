// The streaming normalizer keeps memory flat: generated rows (never committed or written to disk)
// go through @cindermed/normalizer in byte chunks, and the heap after a full GC must not grow
// between the first and the last checkpoint. Runs the probe in its own Node process with
// --expose-gc, on the built package (CI builds packages before the tests).
// PR checks use 100,000 rows (about 2 s); the nightly workflow sets NORMALIZER_MEMORY_ROWS=1000000.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const ROWS = Number(process.env["NORMALIZER_MEMORY_ROWS"] ?? 100_000);
/** Allowed heap growth from the first to the last checkpoint. Measured: under 1 MB at 1,000,000 rows. */
const MAX_GROWTH = 4 * 1024 * 1024;

interface Probe {
  rows: number;
  issues: number;
  checkpoints: { rows: number; heap: number }[];
}

describe("streaming normalizer memory", () => {
  it(`normalizes ${String(ROWS)} rows with a flat heap`, () => {
    const output = execFileSync(
      process.execPath,
      ["--expose-gc", resolve(root, "tooling/normalizer/memory-probe.mjs"), String(ROWS)],
      { encoding: "utf8" },
    );
    const probe = JSON.parse(output) as Probe;
    expect(probe.rows).toBe(ROWS);
    expect(probe.issues).toBe(0);
    const heaps = probe.checkpoints.map((c) => c.heap);
    expect(heaps).toHaveLength(10);
    expect(Math.max(...heaps) - (heaps[0] ?? 0)).toBeLessThan(MAX_GROWTH);
  }, 180_000);
});
