/**
 * The validation worker's logic, without the Worker (tested on its own). Requests come as
 * `{ run, project }`; every run answers `{ run, validation }` or `{ run, error }`, never nothing.
 * Only the newest waiting request runs next: while a run is in progress, a newer request replaces
 * the one waiting, so fast edits never build a queue (the page drops older answers anyway).
 * The definitions are opened once; a failed opening is not kept, so a later run tries again (for
 * example after `cindermed fhir-index` was run).
 */
import type { FhirDefinitions, IndexFetch } from "@cindermed/fhir-defs";
import type { ProjectFile } from "@cindermed/model";
import type { Validation } from "./validate";

export interface ValidationRequest {
  readonly run: number;
  readonly project: ProjectFile;
}

export type ValidationAnswer =
  | { readonly run: number; readonly validation: Validation }
  | { readonly run: number; readonly error: string };

type Definitions = { readonly defs: FhirDefinitions } | { readonly message: string };

export interface QueueDependencies {
  readonly open: () => Promise<Definitions>;
  readonly validate: (
    project: ProjectFile,
    definitions:
      { readonly defs: FhirDefinitions; readonly fetch: IndexFetch } | { readonly message: string },
  ) => Promise<Validation>;
  readonly fetch: IndexFetch;
  readonly post: (answer: ValidationAnswer) => void;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Returns the function that takes each request. */
export function validationQueue(deps: QueueDependencies): (request: ValidationRequest) => void {
  let opened: Promise<Definitions> | undefined;
  let waiting: ValidationRequest | undefined;
  let running = false;

  const definitions = async (): Promise<Definitions> => {
    opened ??= deps.open();
    try {
      const result = await opened;
      if ("message" in result) opened = undefined; // Not found: try again next run.
      return result;
    } catch (error) {
      opened = undefined;
      throw error;
    }
  };

  const runOne = async ({ run, project }: ValidationRequest): Promise<void> => {
    try {
      const found = await definitions();
      const validation = await deps.validate(
        project,
        "defs" in found ? { defs: found.defs, fetch: deps.fetch } : found,
      );
      deps.post({ run, validation });
    } catch (error) {
      deps.post({ run, error: reason(error) });
    }
  };

  const drain = async (): Promise<void> => {
    running = true;
    while (waiting !== undefined) {
      const next = waiting;
      waiting = undefined;
      await runOne(next);
    }
    running = false;
  };

  return (request) => {
    waiting = request; // A newer request replaces the one waiting.
    if (!running) void drain();
  };
}
