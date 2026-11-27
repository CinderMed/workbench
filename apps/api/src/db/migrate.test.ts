import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb, withDatabase } from "../test-support/test-db.js";
import type { Db } from "./connect.js";
import { migrate } from "./migrate.js";

describe.skipIf(!withDatabase)("migrate", () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await testDb()); // applies every migration once
  });
  afterAll(async () => {
    await drop();
  });

  it("records each migration and applies none twice", async () => {
    expect(await migrate(db)).toEqual([]);
    const names = await db.selectFrom("schema_migrations").select("name").execute();
    expect(names.map((n) => n.name)).toEqual(["0001_projects_and_entities.sql"]);
  });

  it("creates the tables of the specification", async () => {
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() ORDER BY table_name`.execute(db);
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "entities",
      "project_members",
      "projects",
      "schema_migrations",
      "users",
    ]);
  });
});
