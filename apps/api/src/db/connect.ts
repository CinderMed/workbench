/**
 * The database connection: Kysely on a pg pool. `searchPath` (tests) puts every table in a schema
 * of its own, so test files run in parallel on one database.
 */
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.js";

export interface DbOptions {
  readonly connectionString: string;
  /** A schema to create and use instead of `public` (tests). */
  readonly searchPath?: string;
  readonly maxConnections?: number;
}

export type Db = Kysely<Database>;

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function connect(options: DbOptions): Promise<Db> {
  const { searchPath } = options;
  if (searchPath !== undefined) {
    if (!SCHEMA_NAME.test(searchPath)) throw new Error(`invalid schema name "${searchPath}"`);
    const setup = new pg.Client({ connectionString: options.connectionString });
    await setup.connect();
    try {
      await setup.query(`CREATE SCHEMA IF NOT EXISTS ${searchPath}`);
    } finally {
      await setup.end();
    }
  }
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    ...(searchPath === undefined ? {} : { options: `-c search_path=${searchPath}` }),
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
