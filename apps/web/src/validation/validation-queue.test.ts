import type { ProjectFile } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import { patientProject, syntheticDefinitions } from "./synthetic-definitions";
import { type QueueDependencies, type ValidationAnswer, validationQueue } from "./validation-queue";
import type { Validation } from "./validate";

const ok: Validation = { results: [], fhir: { kind: "notRun" } };
const settle = () => new Promise((done) => setTimeout(done, 0));

/** A queue whose validations finish only when the test says so. */
function controlled(open: QueueDependencies["open"] = () => Promise.resolve({ message: "none" })) {
  const answers: ValidationAnswer[] = [];
  const started: number[] = [];
  const finish: (() => void)[] = [];
  const opened: number[] = [];
  const take = validationQueue({
    open: () => {
      opened.push(opened.length + 1);
      return open();
    },
    validate: (project) => {
      started.push(project.mappings.length);
      return new Promise((resolve) => {
        finish.push(() => {
          resolve(ok);
        });
      });
    },
    fetch: () => Promise.reject(new Error("not used")),
    post: (answer) => {
      answers.push(answer);
    },
  });
  return { take, answers, started, finish, opened };
}
const projectWith = (rows: number): ProjectFile => {
  const project = patientProject();
  return { ...project, mappings: project.mappings.slice(0, rows) };
};

describe("validationQueue", () => {
  it("runs the newest waiting request next and skips the ones in between", async () => {
    const q = controlled();
    q.take({ run: 1, project: projectWith(0) });
    await settle();
    q.take({ run: 2, project: projectWith(1) });
    q.take({ run: 3, project: projectWith(2) });
    q.take({ run: 4, project: projectWith(1) });
    q.finish.shift()?.();
    await settle();
    q.finish.shift()?.();
    await settle();
    expect(q.started).toEqual([0, 1]); // run 1, then run 4 only
    expect(q.answers.map((a) => a.run)).toEqual([1, 4]);
    expect(q.finish).toHaveLength(0);
  });

  it("answers with the error when a check throws, and keeps going", async () => {
    const answers: ValidationAnswer[] = [];
    let calls = 0;
    const take = validationQueue({
      open: () => Promise.resolve({ message: "none" }),
      validate: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(ok);
      },
      fetch: () => Promise.reject(new Error("not used")),
      post: (answer) => {
        answers.push(answer);
      },
    });
    take({ run: 1, project: projectWith(0) });
    await settle();
    take({ run: 2, project: projectWith(0) });
    await settle();
    expect(answers).toEqual([
      { run: 1, error: "boom" },
      { run: 2, validation: ok },
    ]);
  });

  it("does not keep a failed opening of the definitions: the next run tries again", async () => {
    let attempt = 0;
    const definitions = syntheticDefinitions();
    const answers: ValidationAnswer[] = [];
    const opened: number[] = [];
    const take = validationQueue({
      open: () => {
        attempt += 1;
        opened.push(attempt);
        if (attempt === 1) return Promise.reject(new Error("index.json: network error"));
        if (attempt === 2) return Promise.resolve({ message: "index.json: 404" });
        return Promise.resolve({ defs: definitions.defs });
      },
      validate: (_project, found) =>
        Promise.resolve<Validation>({
          results: [],
          fhir:
            "defs" in found
              ? { kind: "checked", fhirVersion: "4.0.1" }
              : { kind: "unavailable", message: found.message },
        }),
      fetch: definitions.fetch,
      post: (answer) => {
        answers.push(answer);
      },
    });
    for (const run of [1, 2, 3, 4]) {
      take({ run, project: projectWith(0) });
      await settle();
    }
    expect(answers.map((a) => ("error" in a ? a.error : a.validation.fhir.kind))).toEqual([
      "index.json: network error",
      "unavailable",
      "checked",
      "checked",
    ]);
    expect(opened).toEqual([1, 2, 3]); // Opened once it worked, then kept.
  });
});
