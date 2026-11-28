import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { Db } from "../db/connect.js";
import { testAuthenticate, testDb, withDatabase } from "../test-support/test-db.js";

interface Row {
  id: string;
  code: string;
  [key: string]: unknown;
}
interface History {
  revisions: {
    version: string;
    change: string;
    author: { name: string };
    value: Row | null;
    at: string;
  }[];
}
const metastra = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../fixtures/fml-examples/metastra/project.json"),
    "utf8",
  ),
) as {
  project: Record<string, unknown>;
  mappings: Row[];
  sources: { id: string; columns: { id: string }[] }[];
};

describe.skipIf(!withDatabase)("history of objects (#220)", () => {
  let app: FastifyInstance;
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await testDb());
    app = await buildApp({ version: "0.0.0", db, authenticate: testAuthenticate });
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });

  const as = (who: string, options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, "x-test-user": who } });
  let counter = 0;
  const project = async () => {
    counter += 1;
    const id = `prj_hist${String(counter).padStart(4, "0")}`;
    await as("ada", {
      method: "POST",
      url: "/api/projects:import",
      payload: { ...metastra, project: { ...metastra.project, id } },
    });
    await as("bob", { method: "GET", url: "/api/me" });
    const bob = await db
      .selectFrom("users")
      .select("id")
      .where("sub", "=", "sub-bob")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("project_members")
      .values({ project_id: id, user_id: bob.id, role: "mapper" })
      .execute();
    return id;
  };
  const first = metastra.mappings[0];
  if (first === undefined) throw new Error("fixture changed");
  const row: Row = first;
  const historyOf = async (p: string, kind: string, id: string, query = "") =>
    as("bob", { method: "GET", url: `/api/projects/${p}/entities/${kind}/${id}/history${query}` });
  const put = (who: string, p: string, value: Row, version: string) =>
    as(who, {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/${value.id}`,
      headers: { "if-match": `"${version}"` },
      payload: { value },
    });

  it("keeps every state a write leaves a row in, newest first, with its author", async () => {
    const p = await project();
    expect((await put("ada", p, { ...row, code: "R-801" }, "1")).statusCode).toBe(200);
    expect((await put("bob", p, { ...row, code: "R-802" }, "2")).statusCode).toBe(200);
    const history = (await historyOf(p, "mapping", row.id)).json<History>();
    expect(
      history.revisions.map((r) => [r.version, r.change, r.author.name, r.value?.code]),
    ).toEqual([
      ["3", "update", "Bob", "R-802"],
      ["2", "update", "Ada", "R-801"],
      ["1", "import", "Ada", row.code],
    ]);
    expect(history.revisions[0]?.value).toEqual({ ...row, code: "R-802" });
    expect(
      (await historyOf(p, "mapping", row.id, "?limit=1")).json<History>().revisions,
    ).toHaveLength(1);
  });

  it("keeps the history of a deleted object, and of the columns that went with their table", async () => {
    const p = await project();
    const del = await as("bob", {
      method: "DELETE",
      url: `/api/projects/${p}/entities/mapping/${row.id}`,
      headers: { "if-match": '"1"' },
    });
    expect(del.statusCode).toBe(204);
    const history = (await historyOf(p, "mapping", row.id)).json<History>();
    expect(history.revisions.map((r) => [r.version, r.change, r.value === null])).toEqual([
      ["1", "delete", true],
      ["1", "import", false],
    ]);

    // A new table with a column, then the table deleted: the column's history ends too.
    const table = await as("bob", {
      method: "POST",
      url: `/api/projects/${p}/entities:batch`,
      payload: {
        changes: [
          {
            op: "create",
            kind: "source",
            value: {
              id: "src_hist01",
              name: "extra",
              columns: [{ id: "col_hist01", name: "a", dataType: "string" }],
            },
          },
        ],
      },
    });
    expect(table.statusCode).toBe(200);
    await as("bob", {
      method: "DELETE",
      url: `/api/projects/${p}/entities/source/src_hist01`,
      headers: { "if-match": '"1"' },
    });
    const column = (await historyOf(p, "column", "col_hist01")).json<History>();
    expect(column.revisions.map((r) => [r.version, r.change])).toEqual([
      ["1", "delete"],
      ["1", "create"],
    ]);
  });

  it("records nothing for a refused write", async () => {
    const p = await project();
    expect((await put("bob", p, { ...row, code: "R-803" }, "9")).statusCode).toBe(409);
    expect((await put("bob", p, { ...row, transform: { kind: "nope" } }, "1")).statusCode).toBe(
      422,
    );
    expect((await historyOf(p, "mapping", row.id)).json<History>().revisions).toHaveLength(1);
  });

  it("keeps the history of the project settings", async () => {
    const p = await project();
    await as("ada", {
      method: "PATCH",
      url: `/api/projects/${p}`,
      headers: { "if-match": '"1"' },
      payload: { name: "Metastra 2" },
    });
    const settings = (await as("bob", { method: "GET", url: `/api/projects/${p}/history` })).json<{
      revisions: { version: string; change: string; value: { name: string } }[];
    }>();
    expect(settings.revisions.map((r) => [r.version, r.change, r.value.name])).toEqual([
      ["2", "update", "Metastra 2"],
      ["1", "import", metastra.project["name"]],
    ]);
  });

  it("answers only members, for objects that had a history, with a sensible limit", async () => {
    const p = await project();
    expect(
      (
        await as("cy", {
          method: "GET",
          url: `/api/projects/${p}/entities/mapping/${row.id}/history`,
        })
      ).statusCode,
    ).toBe(404);
    expect((await historyOf(p, "mapping", "map_never001")).statusCode).toBe(404);
    for (const limit of ["0", "x", "10000"])
      expect((await historyOf(p, "mapping", row.id, `?limit=${limit}`)).statusCode).toBe(400);
  });
});
