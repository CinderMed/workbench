// Shared helpers of the integrity tests.
import type { Instance, MappingRow, ProjectFile, ValueMap } from "../../generated/project.js";
import type { ValidationResult } from "../../validation-result.js";
import { checkIntegrity } from "../index.js";
import { cleanProject } from "./builder.js";

export function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new Error(`no item ${String(i)}`);
  return item;
}

function byId<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`no object ${id}`);
  return item;
}

export const instance = (p: ProjectFile, id: string): Instance => byId(p.instances, id);
export const row = (p: ProjectFile, id: string): MappingRow => byId(p.mappings, id);
export const valueMap = (p: ProjectFile, id: string): ValueMap => byId(p.valueMaps, id);

/** Integrity results of the clean test project after a mutation. */
export function check(mutate: (project: ProjectFile) => void): ValidationResult[] {
  const project = cleanProject();
  mutate(project);
  return checkIntegrity(project);
}

/** Results with one code. */
export function only(code: string, results: ValidationResult[]): ValidationResult[] {
  return results.filter((result) => result.code === code);
}
