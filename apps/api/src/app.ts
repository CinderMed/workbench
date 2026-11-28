import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { type Authenticate, refuseAll, userOf } from "./auth.js";
import type { Db } from "./db/connect.js";
import { ProblemError, sendProblem } from "./problem.js";
import { memberRoutes } from "./projects/members.js";
import { projectRoutes } from "./projects/routes.js";

export interface HealthResponse {
  status: "ok";
  service: "cindermed-api";
  version: string;
}

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions["logger"];
  /** The database. Without it only the health and documentation routes exist. */
  db?: Db;
  /** Who sent a request (`tokenAuthenticate` in production). Default: nobody, every route 401. */
  authenticate?: Authenticate;
  /**
   * Requests allowed per client address and minute, health checks excepted (default 600). It
   * also limits guessing credentials through the authentication hook.
   */
  rateLimit?: number;
  /** Trusted proxies (Fastify `trustProxy`), so the rate limit counts real client addresses. */
  trustProxy?: string[];
}

/** Routes that answer without a caller. */
const PUBLIC = new Set(["/api/health", "/api/docs"]);

/**
 * Builds the API. Routes live under /api (specification, "REST API"); errors are RFC 9457
 * problem details, and the OpenAPI document is at /api/docs.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // No request bodies or query strings in the logs: they may carry project data.
    disableRequestLogging: true,
    // A whole project file can be imported in one request.
    bodyLimit: 20 * 1024 * 1024,
    // Strict by default: an unknown field or a wrong type is refused, never removed or converted
    // (Fastify's defaults would strip it, which also breaks `oneOf` bodies such as a batch).
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
  });

  // Before every hook and route: a client over its limit is refused before authentication runs.
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimit ?? 600,
    timeWindow: 60_000,
    allowList: (request) => request.url === "/api/health",
    errorResponseBuilder: (_request, context) =>
      new ProblemError({
        code: "too-many-requests",
        status: 429,
        title: "Too many requests",
        detail: `More than ${String(context.max)} requests in a minute: try again in ${context.after}.`,
      }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "CinderMed API", version: options.version },
    },
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ProblemError) return sendProblem(reply, error.problem);
    const { statusCode, message } = (error ?? {}) as { statusCode?: unknown; message?: unknown };
    const status = typeof statusCode === "number" ? statusCode : 500;
    // Only the error's name and code: database messages can quote values (CLAUDE.md, no data in logs).
    if (status >= 500) {
      const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
      app.log.error({ name, code }, "request failed");
    }
    return sendProblem(reply, {
      code: status === 400 ? "bad-request" : status >= 500 ? "internal" : "request-error",
      status,
      title: status >= 500 ? "Internal error" : "The request is not valid",
      // Fastify's own messages name fields, not values; internal errors say nothing more.
      ...(status >= 500 || typeof message !== "string" ? {} : { detail: message }),
    });
  });
  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, {
      code: "not-found",
      status: 404,
      title: "Not found",
      detail: `no route ${request.method} ${request.url.split("?")[0] ?? ""}`,
    }),
  );

  app.get("/api/health", (): HealthResponse => ({
    status: "ok",
    service: "cindermed-api",
    version: options.version,
  }));
  app.get("/api/docs", { schema: { hide: true } }, () => app.swagger());

  const db = options.db;
  if (db !== undefined) {
    const authenticate = options.authenticate ?? refuseAll;
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (PUBLIC.has(path)) return;
      const identity = await authenticate(request);
      if (identity === undefined)
        return sendProblem(reply.header("www-authenticate", "Bearer"), {
          code: "unauthenticated",
          status: 401,
          title: "Authentication required",
          detail: "Sign in: every project route needs an authenticated user.",
        });
      request.user = await userOf(db, identity);
    });
    projectRoutes(app, db);
    memberRoutes(app, db);
  }

  return app;
}
