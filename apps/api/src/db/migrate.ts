/**
 * SQL migrations (specification, "Stack": Kysely and SQL migrations): the files of `migrations/`,
 * applied in name order, each once and in its own transaction, recorded in `schema_migrations`.
 * An advisory lock keeps two API instances from migrating at the same time.
 */
import { readFile, readdir } from "node:fs/promises";
import { sql } from "kysely";
import type { Db } from "./connect.js";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
/** Any constant: the advisory lock of the migrations. */
const LOCK = 7_204_219;

export async function migrate(db: Db): Promise<string[]> {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
  return db.connection().execute(async (conn) => {
    await sql`SELECT pg_advisory_lock(${LOCK})`.execute(conn);
    try {
      await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`.execute(conn);
      const done = new Set(
        (await conn.selectFrom("schema_migrations").select("name").execute()).map((r) => r.name),
      );
      const applied: string[] = [];
      for (const file of files) {
        if (done.has(file)) continue;
        const text = await readFile(new URL(file, MIGRATIONS), "utf8");
        await conn.transaction().execute(async (trx) => {
          await sql.raw(text).execute(trx);
          await trx.insertInto("schema_migrations").values({ name: file }).execute();
        });
        applied.push(file);
      }
      return applied;
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK})`.execute(conn);
    }
  });
}
