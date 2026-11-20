// @vitest-environment node
// The production build of the web app (the Docker image) does not contain the local mode
// (ADR-0021): the local mode has no login and runs only in the Vite dev server, bound to localhost.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const web = resolve(import.meta.dirname, "..");
const repoRoot = resolve(web, "../..");
const outDir = join(repoRoot, ".tmp/web-build-check");

/** Strings that survive minification and exist only in the local-mode code. */
const LOCAL_MODE_CODE = ["showOpenFilePicker", "load the project first", "changed outside the app"];

describe("web production build", () => {
  let bundle = "";
  beforeAll(() => {
    // A separate process: inside Vitest NODE_ENV is "test", and Vite would build for development.
    execFileSync(
      process.execPath,
      [
        join(web, "node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        outDir,
        "--emptyOutDir",
        "--logLevel",
        "silent",
      ],
      { cwd: web, env: { ...process.env, NODE_ENV: "production" }, stdio: "pipe" },
    );
    const assets = join(outDir, "assets");
    bundle = readdirSync(assets)
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFileSync(join(assets, file), "utf8"))
      .join("\n");
  }, 120_000);

  it("is built", () => {
    expect(bundle.length).toBeGreaterThan(0);
  });

  it.each(LOCAL_MODE_CODE)("does not contain the local mode (%s)", (marker) => {
    expect(bundle).not.toContain(marker);
  });
});
