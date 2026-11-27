/**
 * Who is calling. Keycloak manages identity only (specification, "Permissions"): the API knows a
 * caller by the OIDC subject and keeps a `users` row for it. The JWT check comes with #19; until
 * then the default refuses every caller, so no route answers without an authenticated user.
 */
import type { FastifyRequest } from "fastify";
import type { Db } from "./db/connect.js";

/** The identity a token proves. */
export interface Identity {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
}

/** A caller with its `users` row. */
export interface User extends Identity {
  readonly id: string;
}

/** Proves who sent a request: its identity, or undefined when it cannot. */
export type Authenticate = (request: FastifyRequest) => Promise<Identity | undefined>;

/** Refuses every caller. */
export const refuseAll: Authenticate = () => Promise.resolve(undefined);

/** The `users` row of an identity, created on first sight, with its name and email kept current. */
export async function userOf(db: Db, identity: Identity): Promise<User> {
  const row = await db
    .insertInto("users")
    .values({ sub: identity.sub, name: identity.name, email: identity.email })
    .onConflict((oc) =>
      oc.column("sub").doUpdateSet({ name: identity.name, email: identity.email }),
    )
    .returning(["id", "sub", "name", "email"])
    .executeTakeFirstOrThrow();
  return row;
}
