/**
 * Errors as RFC 9457 problem details (`application/problem+json`, specification, "REST API").
 * Messages name objects and fields, never data values.
 */
import type { FastifyReply } from "fastify";

export interface Problem {
  /** A stable code, also the last segment of `type`. */
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  /** Extension members (RFC 9457 §3.2), such as validation results. */
  readonly [extension: string]: unknown;
}

export const PROBLEM_TYPE_BASE = "https://cindermed.org/problems/";

export class ProblemError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}

export function sendProblem(reply: FastifyReply, problem: Problem): FastifyReply {
  const { code, ...rest } = problem;
  return reply
    .status(problem.status)
    .type("application/problem+json")
    .send({ type: `${PROBLEM_TYPE_BASE}${code}`, code, ...rest });
}

export const notFound = (detail: string): ProblemError =>
  new ProblemError({ code: "not-found", status: 404, title: "Not found", detail });
