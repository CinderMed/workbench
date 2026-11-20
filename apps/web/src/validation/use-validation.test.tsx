import type { ProjectFile } from "@cindermed/model";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { patientProject } from "./synthetic-definitions";
import { type Validator, type WorkerLike, useValidation, workerValidator } from "./use-validation";
import type { ValidationAnswer } from "./validation-queue";
import type { Validation } from "./validate";

describe("useValidation", () => {
  it("drops the answer of an older run, even when it arrives last", async () => {
    const answers: ((v: Validation) => void)[] = [];
    const validator: Validator = () =>
      new Promise((resolve) => {
        answers.push(resolve);
      });
    const first = patientProject();
    const second: ProjectFile = { ...first, mappings: [] };
    const { result, rerender } = renderHook(({ project }) => useValidation(project, validator), {
      initialProps: { project: first },
    });
    rerender({ project: second });
    const stale: Validation = {
      results: [{ severity: "error", code: "OLD", objectKind: "project", message: "old" }],
      fhir: { kind: "notRun" },
    };
    const fresh: Validation = { results: [], fhir: { kind: "checked", fhirVersion: "4.0.1" } };
    await act(async () => {
      answers[1]?.(fresh);
      await Promise.resolve();
    });
    await act(async () => {
      answers[0]?.(stale);
      await Promise.resolve();
    });
    expect(result.current).toEqual(fresh);
  });
});

describe("useValidation failures and workerValidator", () => {
  it("shows that the check failed, and why, instead of waiting forever", async () => {
    const validator: Validator = () => Promise.reject(new Error("index.json is not JSON"));
    const project = patientProject();
    const { result } = renderHook(() => useValidation(project, validator));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ failed: "index.json is not JSON" });
  });

  it("matches answers to runs, rejects on an error answer, and ends skipped runs", async () => {
    const posted: unknown[] = [];
    const worker: WorkerLike = {
      onmessage: null,
      postMessage: (message) => {
        posted.push(message);
      },
    };
    const validate = workerValidator(worker);
    const settled: string[] = [];
    const track = (name: string, p: Promise<Validation>) => {
      p.then(
        () => settled.push(`${name} ok`),
        (e: unknown) => settled.push(`${name} ${e instanceof Error ? e.message : ""}`),
      );
    };
    track("1", validate(patientProject()));
    track("2", validate(patientProject()));
    track("3", validate(patientProject()));
    expect(posted).toHaveLength(3);
    const answer = (data: ValidationAnswer) =>
      worker.onmessage?.({ data } as MessageEvent<ValidationAnswer>);
    answer({ run: 1, error: "boom" });
    answer({ run: 3, validation: { results: [], fhir: { kind: "notRun" } } }); // run 2 was skipped
    answer({ run: 2, validation: { results: [], fhir: { kind: "notRun" } } }); // late: ignored
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toEqual(["1 boom", "3 ok"]);
  });
});
