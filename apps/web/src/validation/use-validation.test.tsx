import type { ProjectFile } from "@cindermed/model";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { patientProject } from "./synthetic-definitions";
import { type Validator, useValidation } from "./use-validation";
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
