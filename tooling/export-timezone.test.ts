// The export zip is the same in every time zone (ADR-0012): the ZIP timestamp is written from the
// local-time fields of a Date, so the exporter builds that Date from the UTC fields of createdAt.
// Exports the MOTU fixture in two Node processes with different TZ and compares the bytes. Runs on
// the built package (CI builds packages before the tests); nothing is written to disk.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const script = `
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { exportPackage } from ${JSON.stringify(resolve(root, "packages/export/dist/index.js"))};
const text = readFileSync(${JSON.stringify(resolve(root, "fixtures/fml-examples/motu/project.json"))}, "utf8");
const result = exportPackage(text, { createdAt: "2026-11-12T23:30:00Z", packageVersion: "0.1.0", generator: { name: "cindermed", version: "test" } });
if (!result.ok) throw new Error("export failed");
process.stdout.write(createHash("sha256").update(result.zip).digest("hex"));
`;

const zipDigest = (tz: string): string =>
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: tz },
  });

describe("export zip across time zones", () => {
  it("gives the same bytes in UTC, Rome and Kiritimati (UTC+14, another calendar day)", () => {
    const utc = zipDigest("UTC");
    expect(utc).toMatch(/^[0-9a-f]{64}$/);
    expect(zipDigest("Europe/Rome")).toBe(utc);
    expect(zipDigest("Pacific/Kiritimati")).toBe(utc);
  }, 60_000);
});
