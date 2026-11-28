import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ version: "1.2.3" });
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
    // RFC 9457 problem details.
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ code: "not-found", status: 404 });
  });

  it("serves the OpenAPI document at /api/docs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/docs" });
    expect(response.json()).toMatchObject({ openapi: "3.1.0", info: { version: "1.2.3" } });
  });
});

describe("rate limit", () => {
  it("counts the address the trusted proxy forwards, not the proxy's", async () => {
    const limited = await buildApp({ version: "1.2.3", rateLimit: 1, trustProxy: ["127.0.0.1"] });
    try {
      const from = (address: string) =>
        limited.inject({
          method: "GET",
          url: "/api/docs",
          headers: { "x-forwarded-for": address },
        });
      expect((await from("192.0.2.1")).statusCode).toBe(200);
      expect((await from("192.0.2.2")).statusCode).toBe(200);
      expect((await from("192.0.2.1")).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it("answers 429 as a problem past the limit, and never limits the health check", async () => {
    const limited = await buildApp({ version: "1.2.3", rateLimit: 2 });
    try {
      const docs = () => limited.inject({ method: "GET", url: "/api/docs" });
      expect((await docs()).statusCode).toBe(200);
      expect((await docs()).statusCode).toBe(200);
      const refused = await docs();
      expect(refused.statusCode).toBe(429);
      expect(refused.headers["content-type"]).toContain("application/problem+json");
      expect(refused.json()).toMatchObject({ code: "too-many-requests", status: 429 });
      for (let i = 0; i < 5; i++)
        expect((await limited.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});
