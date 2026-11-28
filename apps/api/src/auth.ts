/**
 * Who is calling (A2, #19, ADR-0027). Keycloak manages identity only (specification,
 * "Permissions"): the API checks the access token of each request against the realm's public
 * keys and knows the caller by the OIDC subject, with a `users` row for it. Roles are per project
 * and live in the database. Without an issuer configured, every caller is refused.
 */
import type { FastifyRequest } from "fastify";
import { type JWTVerifyGetKey, errors, jwtVerify } from "jose";
import type { Db } from "./db/connect.js";

/** The identity a token proves. */
export interface Identity {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
  /** Whether the identity provider has verified the email: only then are invitations accepted. */
  readonly emailVerified: boolean;
}

/** A caller with its `users` row. */
export interface User extends Identity {
  readonly id: string;
}

/** Proves who sent a request: its identity, or undefined when it cannot. */
export type Authenticate = (request: FastifyRequest) => Promise<Identity | undefined>;

/** Refuses every caller. */
export const refuseAll: Authenticate = () => Promise.resolve(undefined);

export interface TokenCheck {
  /** The realm's issuer URL, as tokens name it (`iss`). */
  readonly issuer: string;
  /** The web client: tokens must have been issued to it (`azp`). */
  readonly clientId: string;
  /** The realm's public keys (a remote JWKS in production, a local one in tests). */
  readonly keys: JWTVerifyGetKey;
}

/**
 * Checks the bearer access token: signature with the realm's keys (RS256), issuer, expiry, and
 * that it was issued to the web client. Keycloak does not put the API in `aud` without an
 * audience mapper, so `azp` is the client check. A missing or bad token is no identity (401);
 * the reason is never logged with the token.
 */
export function tokenAuthenticate(check: TokenCheck): Authenticate {
  return async (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") === true ? header.slice(7).trim() : undefined;
    if (token === undefined || token === "") return undefined;
    try {
      const { payload } = await jwtVerify(token, check.keys, {
        issuer: check.issuer,
        algorithms: ["RS256"],
        clockTolerance: 5,
      });
      if (payload["azp"] !== check.clientId || typeof payload.sub !== "string") return undefined;
      const email = typeof payload["email"] === "string" ? payload["email"] : "";
      const name =
        [payload["name"], payload["preferred_username"], email].find(
          (v): v is string => typeof v === "string" && v !== "",
        ) ?? payload.sub;
      return { sub: payload.sub, name, email, emailVerified: payload["email_verified"] === true };
    } catch (error) {
      // A bad token is no identity. So is a token that cannot be checked because the keys could
      // not be fetched: that one is logged, by error name only (no token, no message).
      if (!(error instanceof errors.JOSEError) || error instanceof errors.JWKSTimeout)
        request.log.warn({ name: (error as { name?: unknown }).name }, "token not checked");
      return undefined;
    }
  };
}

/**
 * The `users` row of an identity, created on first sight, with its name and email kept current.
 * A verified email also accepts the invitations waiting for it (A2: no mail server in the MVP).
 */
export async function userOf(db: Db, identity: Identity): Promise<User> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("users")
      .values({
        sub: identity.sub,
        name: identity.name,
        email: identity.email,
        email_verified: identity.emailVerified,
      })
      .onConflict((oc) =>
        oc.column("sub").doUpdateSet({
          name: identity.name,
          email: identity.email,
          email_verified: identity.emailVerified,
        }),
      )
      .returning(["id"])
      .executeTakeFirstOrThrow();
    if (identity.emailVerified && identity.email !== "") {
      const email = identity.email.toLowerCase();
      const waiting = await trx
        .deleteFrom("invitations")
        .where("email", "=", email)
        .returning(["project_id", "role"])
        .execute();
      if (waiting.length > 0)
        await trx
          .insertInto("project_members")
          .values(waiting.map((w) => ({ project_id: w.project_id, user_id: row.id, role: w.role })))
          .onConflict((oc) => oc.doNothing())
          .execute();
    }
    return { ...identity, id: row.id };
  });
}
