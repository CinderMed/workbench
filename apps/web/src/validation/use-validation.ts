import type { ProjectFile } from "@cindermed/model";
import { useEffect, useRef, useState } from "react";
import type { ValidationAnswer } from "./validation-queue";
import type { Validation } from "./validate";

/** Validates a project; a later call supersedes an earlier one still running. */
export type Validator = (project: ProjectFile) => Promise<Validation>;

/** The latest check: its results, or why it failed. */
export type ValidationState = Validation | { readonly failed: string };

/**
 * The validation of the current project. Every change starts a new run; the answer of an older
 * run is dropped, so results of an older project never colour the cells (ADR-0021). A run that
 * fails says why, instead of leaving the page waiting.
 */
export function useValidation(
  project: ProjectFile,
  validator: Validator,
): ValidationState | undefined {
  const [state, setState] = useState<ValidationState | undefined>();
  const latest = useRef(0);
  useEffect(() => {
    latest.current += 1;
    const run = latest.current;
    validator(project).then(
      (validation) => {
        if (run === latest.current) setState(validation);
      },
      (error: unknown) => {
        if (run === latest.current)
          setState({ failed: error instanceof Error ? error.message : String(error) });
      },
    );
  }, [project, validator]);
  return state;
}

/** The subset of `Worker` used here. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<ValidationAnswer>) => void) | null;
  postMessage(message: unknown): void;
}

/**
 * A validator running in a Web Worker. Answers are matched to their run; the worker skips runs
 * that a newer request replaced, so an answer for run n also ends the runs before it (they stay
 * unresolved and are dropped, as the page would drop them).
 */
export function workerValidator(worker: WorkerLike): Validator {
  let run = 0;
  const pending = new Map<
    number,
    { resolve: (v: Validation) => void; reject: (error: Error) => void }
  >();
  worker.onmessage = (event) => {
    const answer = event.data;
    const waiting = pending.get(answer.run);
    for (const key of [...pending.keys()]) if (key <= answer.run) pending.delete(key);
    if (waiting === undefined) return;
    if ("error" in answer) waiting.reject(new Error(answer.error));
    else waiting.resolve(answer.validation);
  };
  return (project) =>
    new Promise((resolve, reject) => {
      run += 1;
      pending.set(run, { resolve, reject });
      worker.postMessage({ run, project });
    });
}
