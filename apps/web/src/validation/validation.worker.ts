/**
 * Validation off the main thread (ADR-0021, section 5). Takes `{ run, project }`, answers
 * `{ run, validation }`; the page drops answers of older runs. The definition index is read from
 * the dev server (`/fhir-index/`, local mode) once, then documents are loaded as projects need them.
 */
import type { ProjectFile } from "@cindermed/model";
import { openDefinitions, validateAll } from "./validate";

export interface ValidationRequest {
  readonly run: number;
  readonly project: ProjectFile;
}

const BASE = "/fhir-index/";
const fetchIndex = async (file: string): Promise<string> => {
  const response = await fetch(`${BASE}${file}`);
  if (!response.ok)
    throw new Error(
      `${BASE}${file}: ${String(response.status)}; write it with cindermed fhir-index --out apps/web/.fhir-index`,
    );
  return response.text();
};
let opened: ReturnType<typeof openDefinitions> | undefined;

self.onmessage = (event: MessageEvent<ValidationRequest>) => {
  const { run, project } = event.data;
  opened ??= openDefinitions(fetchIndex);
  void opened
    .then((definitions) =>
      validateAll(
        project,
        "defs" in definitions ? { ...definitions, fetch: fetchIndex } : definitions,
      ),
    )
    .then((validation) => {
      self.postMessage({ run, validation });
    });
};
