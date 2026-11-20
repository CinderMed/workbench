/**
 * Validation off the main thread (ADR-0021, section 5): `validationQueue` with the dev server's
 * definition index (`/fhir-index/`, written by `cindermed fhir-index`) and the real checks.
 */
import { type ValidationRequest, validationQueue } from "./validation-queue";
import { openDefinitions, validateAll } from "./validate";

const BASE = "/fhir-index/";
const fetchIndex = async (file: string): Promise<string> => {
  const response = await fetch(`${BASE}${file}`);
  if (!response.ok)
    throw new Error(
      `${BASE}${file}: ${String(response.status)}; write it with cindermed fhir-index --out apps/web/.fhir-index`,
    );
  return response.text();
};

const take = validationQueue({
  open: () => openDefinitions(fetchIndex),
  validate: validateAll,
  fetch: fetchIndex,
  post: (answer) => {
    self.postMessage(answer);
  },
});

self.onmessage = (event: MessageEvent<ValidationRequest>) => {
  take(event.data);
};
