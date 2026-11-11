#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
