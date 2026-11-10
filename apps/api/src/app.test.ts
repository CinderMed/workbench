import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let app: FastifyInstance;

beforeEach(() => {
  app = buildApp({ version: "1.2.3" });
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/health", () => {
  it("reports the service and its version", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "cindermed-api", version: "1.2.3" });
  });

  it("answers 404 outside the known routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/unknown" });
    expect(response.statusCode).toBe(404);
  });
});
