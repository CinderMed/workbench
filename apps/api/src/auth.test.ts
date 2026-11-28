import type { FastifyRequest } from "fastify";
import { type JWK, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Authenticate, tokenAuthenticate } from "./auth.js";

const ISSUER = "http://localhost:8081/realms/cindermed";
const CLIENT = "cindermed-web";

let sign: (
  claims: Record<string, unknown>,
  options?: { exp?: string; key?: "other" },
) => Promise<string>;
let authenticate: Authenticate;

beforeAll(async () => {
  const realm = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(realm.publicKey)), kid: "realm", alg: "RS256" };
  authenticate = tokenAuthenticate({
    issuer: ISSUER,
    clientId: CLIENT,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
  sign = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "realm" })
      .setIssuedAt()
      .setExpirationTime(options.exp ?? "5m")
      .sign(options.key === "other" ? other.privateKey : realm.privateKey);
});

const request = (authorization?: string) =>
  ({
    headers: authorization === undefined ? {} : { authorization },
    log: { warn: vi.fn() },
  }) as unknown as FastifyRequest;

const claims = {
  iss: ISSUER,
  azp: CLIENT,
  sub: "kc-sub-1",
  name: "Mapper One",
  preferred_username: "mapper",
  email: "mapper@cindermed.test",
  email_verified: true,
};

describe("tokenAuthenticate (#19)", () => {
  it("proves the identity of a token signed by the realm for the web client", async () => {
    expect(await authenticate(request(`Bearer ${await sign(claims)}`))).toEqual({
      sub: "kc-sub-1",
      name: "Mapper One",
      email: "mapper@cindermed.test",
      emailVerified: true,
    });
  });

  it("falls back to the username for the name, and keeps an unverified email unverified", async () => {
    const token = await sign({ ...claims, name: undefined, email_verified: false });
    expect(await authenticate(request(`Bearer ${token}`))).toMatchObject({
      name: "mapper",
      emailVerified: false,
    });
  });

  it.each([
    ["no header", undefined],
    ["another scheme", "Basic bWFwcGVyOng="],
    ["an empty token", "Bearer "],
    ["not a JWT", "Bearer not-a-token"],
  ])("refuses %s", async (_what, header) => {
    expect(await authenticate(request(header))).toBeUndefined();
  });

  it("refuses another issuer, another client, an expired token and another key", async () => {
    const cases = [
      await sign({ ...claims, iss: "http://evil.example/realms/cindermed" }),
      await sign({ ...claims, azp: "another-client" }),
      await sign(claims, { exp: "-1m" }),
      await sign(claims, { key: "other" }),
      await sign({ ...claims, sub: undefined }),
    ];
    for (const token of cases)
      expect(await authenticate(request(`Bearer ${token}`))).toBeUndefined();
  });

  it("refuses an unsigned token", async () => {
    const [, payload] = (await sign(claims)).split(".");
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    expect(await authenticate(request(`Bearer ${header}.${payload ?? ""}.`))).toBeUndefined();
  });
});
