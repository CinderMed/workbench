/**
 * Tests only: a migrated database in a schema of its own, on `TEST_DATABASE_URL` (a Postgres 17
 * service container in CI; locally, for example a container on 127.0.0.1:55432). Without the
 * variable the database tests are skipped, except in CI, where they fail.
 */
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { FastifyRequest } from "fastify";
import type { Authenticate, Identity } from "../auth.js";
import { type Db, connect } from "../db/connect.js";
import { migrate } from "../db/migrate.js";

export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
/** Whether the database tests run: always in CI, else only with TEST_DATABASE_URL. */
export const withDatabase = TEST_DATABASE_URL !== undefined || process.env["CI"] !== undefined;

export async function testDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  if (TEST_DATABASE_URL === undefined)
    throw new Error("TEST_DATABASE_URL is not set: the database tests need PostgreSQL 17");
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const db = await connect({
    connectionString: TEST_DATABASE_URL,
    searchPath: schema,
    maxConnections: 4,
  });
  await migrate(db);
  return {
    db,
    drop: async () => {
      await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
      await db.destroy();
    },
  };
}

/** Test identities, chosen by the `x-test-user` header. */
export const PEOPLE: Readonly<Record<string, Identity>> = {
  ada: { sub: "sub-ada", name: "Ada", email: "ada@example.org", emailVerified: true },
  bob: { sub: "sub-bob", name: "Bob", email: "bob@example.org", emailVerified: true },
  cy: { sub: "sub-cy", name: "Cy", email: "cy@example.org", emailVerified: true },
  dee: { sub: "sub-dee", name: "Dee", email: "dee@example.org", emailVerified: true },
  /** Email not verified by the identity provider: invitations are not accepted. */
  eve: { sub: "sub-eve", name: "Eve", email: "eve@example.org", emailVerified: false },
};

export const testAuthenticate: Authenticate = (request: FastifyRequest) => {
  const who = request.headers["x-test-user"];
  return Promise.resolve(typeof who === "string" ? PEOPLE[who] : undefined);
};
