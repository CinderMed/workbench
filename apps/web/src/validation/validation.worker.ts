/**
 * Validation off the main thread (ADR-0021, section 5): `validationQueue` with the dev server's
 * definition index (`/fhir-index/`, written by `cindermed fhir-index`) and the real checks.
 */
import { fetchIndex } from "./index-fetch";
import { type ValidationRequest, validationQueue } from "./validation-queue";
import { openDefinitions, validateAll } from "./validate";

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
