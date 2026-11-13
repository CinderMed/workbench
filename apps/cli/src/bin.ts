#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { run } from "./cli.js";
import { loadDefinitions } from "./fhir-packages.js";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

process.exitCode = await run(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  writeFile: async (path, data) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },
  now: () => new Date(),
  version: manifest.version,
  loadDefinitions,
});
