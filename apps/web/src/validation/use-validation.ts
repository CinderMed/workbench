import type { ProjectFile } from "@cindermed/model";
import { useEffect, useRef, useState } from "react";
import type { Validation } from "./validate";

/** Validates a project; a later call supersedes an earlier one still running. */
export type Validator = (project: ProjectFile) => Promise<Validation>;

/**
 * The validation of the current project. Every change starts a new run; the answer of an older
 * run is dropped, so results of an older project never colour the cells (ADR-0021).
 */
export function useValidation(project: ProjectFile, validator: Validator): Validation | undefined {
  const [validation, setValidation] = useState<Validation | undefined>();
  const latest = useRef(0);
  useEffect(() => {
    latest.current += 1;
    const run = latest.current;
    void validator(project).then((result) => {
      if (run === latest.current) setValidation(result);
    });
  }, [project, validator]);
  return validation;
}

/** A validator running in a Web Worker; answers are matched to their run. */
export function workerValidator(worker: Worker): Validator {
  let run = 0;
  const pending = new Map<number, (validation: Validation) => void>();
  worker.onmessage = (event: MessageEvent<{ run: number; validation: Validation }>) => {
    pending.get(event.data.run)?.(event.data.validation);
    pending.delete(event.data.run);
  };
  return (project) =>
    new Promise((resolve) => {
      run += 1;
      pending.set(run, resolve);
      worker.postMessage({ run, project });
    });
}
