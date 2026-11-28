import { describe, expect, it } from "vitest";
import { readServerConfig } from "./config.js";

describe("readServerConfig", () => {
  it("defaults to 0.0.0.0:3000", () => {
    expect(readServerConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
  });

  it("reads HOST and PORT", () => {
    expect(readServerConfig({ HOST: "127.0.0.1", PORT: "8000" })).toEqual({
      host: "127.0.0.1",
      port: 8000,
    });
  });

  it("reads DATABASE_URL when set", () => {
    expect(readServerConfig({ DATABASE_URL: "postgres://x@db/y" }).databaseUrl).toBe(
      "postgres://x@db/y",
    );
    expect(readServerConfig({ DATABASE_URL: "" })).not.toHaveProperty("databaseUrl");
  });

  it("reads the sign-in settings, with the certificate endpoint and client defaulted (#19)", () => {
    expect(readServerConfig({ OIDC_ISSUER: "http://kc:8081/realms/r/" }).oidc).toEqual({
      issuer: "http://kc:8081/realms/r",
      clientId: "cindermed-web",
      jwksUrl: "http://kc:8081/realms/r/protocol/openid-connect/certs",
    });
    expect(
      readServerConfig({
        OIDC_ISSUER: "http://localhost:8081/realms/cindermed",
        OIDC_CLIENT_ID: "web",
        OIDC_JWKS_URL: "http://keycloak:8080/realms/cindermed/protocol/openid-connect/certs",
      }).oidc,
    ).toMatchObject({
      clientId: "web",
      jwksUrl: expect.stringContaining("keycloak:8080") as unknown,
    });
    expect(readServerConfig({ OIDC_ISSUER: "" })).not.toHaveProperty("oidc");
  });

  it("reads the trusted proxies as addresses, ranges or names", () => {
    expect(readServerConfig({ TRUST_PROXY: "uniquelocal" }).trustProxy).toEqual(["uniquelocal"]);
    expect(readServerConfig({ TRUST_PROXY: "10.0.0.0/8, 127.0.0.1" }).trustProxy).toEqual([
      "10.0.0.0/8",
      "127.0.0.1",
    ]);
    expect(readServerConfig({})).not.toHaveProperty("trustProxy");
  });

  it.each(["0", "70000", "abc", "3.5"])("rejects PORT=%s", (port) => {
    expect(() => readServerConfig({ PORT: port })).toThrow("PORT must be an integer");
  });
});
