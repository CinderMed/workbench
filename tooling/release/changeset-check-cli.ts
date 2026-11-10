// CI entry point: BASE_SHA, HEAD_SHA, HEAD_REF and PR_LABELS (JSON array of names) from the workflow.
import { execFileSync } from "node:child_process";
import { checkChangeset } from "./changeset-check.ts";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

const changedFiles = execFileSync(
  "git",
  ["diff", "--name-only", `${env("BASE_SHA")}...${env("HEAD_SHA")}`],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
const labels = JSON.parse(env("PR_LABELS")) as string[];
const result = checkChangeset({ changedFiles, labels, headRef: env("HEAD_REF") });

console.log(result.reason);
if (!result.ok) process.exitCode = 1;
