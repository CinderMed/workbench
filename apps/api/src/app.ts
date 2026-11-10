import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

export interface HealthResponse {
  status: "ok";
  service: "cindermed-api";
  version: string;
}

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions["logger"];
}

/** Builds the API. Routes live under /api (specification, "REST API"). */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // No request bodies or query strings in the logs: they may carry project data.
    disableRequestLogging: true,
  });

  app.get("/api/health", (): HealthResponse => ({
    status: "ok",
    service: "cindermed-api",
    version: options.version,
  }));

  return app;
}
