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
const motu = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../fixtures/fml-examples/motu/project.json"),
    "utf8",
  ),
) as { project: Record<string, unknown>; mappings: Row[] };

describe.skipIf(!withDatabase)("safe concurrent saving (A3, #20)", () => {
  let app: FastifyInstance;
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ db, drop } = await testDb());
    app = await buildApp({
      version: "0.0.0",
      db,
      authenticate: testAuthenticate,
      rateLimit: 10_000,
    });
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });

  const as = (who: string, options: InjectOptions) =>
    app.inject({ ...options, headers: { ...options.headers, "x-test-user": who } });
  let counter = 0;
  /** A MOTU project owned by ada, with bob as a mapper and eve as a viewer. */
  const project = async () => {
    counter += 1;
    const id = `prj_conc${String(counter).padStart(4, "0")}`;
    await as("ada", {
      method: "POST",
      url: "/api/projects:import",
      payload: { ...motu, project: { ...motu.project, id } },
    });
    for (const [who, role] of [
      ["bob", "mapper"],
      ["eve", "viewer"],
    ] as const) {
      await as(who, { method: "GET", url: "/api/me" });
      const user = await db
        .selectFrom("users")
        .select("id")
        .where("sub", "=", `sub-${who}`)
        .executeTakeFirstOrThrow();
      await db
        .insertInto("project_members")
        .values({ project_id: id, user_id: user.id, role })
        .execute();
    }
    return id;
  };
  const row = (i = 0): Row => {
    const found = motu.mappings[i];
    if (found === undefined) throw new Error("fixture changed");
    return found;
  };
  const put = (who: string, p: string, value: Row, version: string | undefined) =>
    as(who, {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/${value.id}`,
      ...(version === undefined ? {} : { headers: { "if-match": `"${version}"` } }),
      payload: { value },
    });

  it("refuses the second of two edits to the same row with the current version, and takes the retry", async () => {
    const p = await project();
    const url = `/api/projects/${p}/entities/mapping/${row().id}`;
    const read = await as("ada", { method: "GET", url });
    expect(read.headers.etag).toBe('"1"');

    // bob saves first; ada saves on top of what she read.
    expect((await put("bob", p, { ...row(), code: "R-801" }, "1")).json()).toMatchObject({
      version: "2",
    });
    const lost = await put("ada", p, { ...row(), code: "R-802" }, "1");
    expect(lost.statusCode).toBe(409);
    expect(lost.headers["content-type"]).toContain("application/problem+json");
    expect(lost.json()).toMatchObject({
      code: "conflict",
      conflicts: [{ kind: "mapping", id: row().id, version: "2", value: { code: "R-801" } }],
    });
    // Nothing of ada's was kept; she chooses, and saves on top of the current version.
    expect((await as("ada", { method: "GET", url })).json()).toMatchObject({
      version: "2",
      value: { code: "R-801" },
    });
    expect((await put("ada", p, { ...row(), code: "R-802" }, "2")).json()).toMatchObject({
      version: "3",
    });
  });

  it("does not let two writers in at once: of ten saves on the same version, one wins", async () => {
    const p = await project();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        put(i % 2 === 0 ? "ada" : "bob", p, { ...row(), code: `R-${String(810 + i)}` }, "1"),
      ),
    );
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, ...Array<number>(9).fill(409)]);
  });

  it("keeps edits to different objects apart: no conflict", async () => {
    const p = await project();
    expect((await put("ada", p, { ...row(0), code: "R-803" }, "1")).statusCode).toBe(200);
    expect((await put("bob", p, { ...row(1), code: "R-804" }, "1")).statusCode).toBe(200);
  });

  it("needs If-Match on every update and delete, and on the settings", async () => {
    const p = await project();
    for (const header of [undefined, "*", "abc", '"x"']) {
      const response = await as("ada", {
        method: "PUT",
        url: `/api/projects/${p}/entities/mapping/${row().id}`,
        ...(header === undefined ? {} : { headers: { "if-match": header } }),
        payload: { value: row() },
      });
      expect([header, response.statusCode]).toEqual([header, 428]);
    }
    expect(
      (
        await as("ada", {
          method: "DELETE",
          url: `/api/projects/${p}/entities/mapping/${row().id}`,
        })
      ).json(),
    ).toMatchObject({ code: "precondition-required" });
    expect(
      (await as("ada", { method: "PATCH", url: `/api/projects/${p}`, payload: {} })).statusCode,
    ).toBe(428);
    // A weak or unquoted tag is read too.
    expect((await put("ada", p, row(), undefined)).statusCode).toBe(428);
    const unquoted = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/${row().id}`,
      headers: { "if-match": "1" },
      payload: { value: row() },
    });
    expect(unquoted.statusCode).toBe(200);
    const settings = await as("ada", { method: "GET", url: `/api/projects/${p}` });
    expect(settings.headers.etag).toBe('"1"');
    const patched = await as("ada", {
      method: "PATCH",
      url: `/api/projects/${p}`,
      headers: { "if-match": 'W/"1"' },
      payload: { name: "MOTU 2" },
    });
    expect(patched.json()).toMatchObject({ version: "2" });
    const stale = await as("ada", {
      method: "PATCH",
      url: `/api/projects/${p}`,
      headers: { "if-match": '"1"' },
      payload: { name: "MOTU 3" },
    });
    expect(stale.json()).toMatchObject({
      code: "conflict",
      conflicts: [{ kind: "project", version: "2", value: { name: "MOTU 2" } }],
    });
  });

  describe("batches (D8): one transaction, all or nothing", () => {
    const batch = (who: string, p: string, changes: unknown[]) =>
      as(who, { method: "POST", url: `/api/projects/${p}/entities:batch`, payload: { changes } });

    it("applies creates, updates and deletes together, giving new objects ids", async () => {
      const p = await project();
      const fresh: Partial<Row> = { ...row(0), code: "R-900" };
      delete fresh.id;
      const response = await batch("bob", p, [
        { op: "create", kind: "mapping", value: fresh },
        {
          op: "update",
          kind: "mapping",
          id: row(1).id,
          value: { ...row(1), code: "R-901" },
          readVersion: "1",
        },
        { op: "delete", kind: "mapping", id: row(2).id, readVersion: "1" },
      ]);
      expect(response.statusCode).toBe(200);
      const { objects } = response.json<{
        objects: { op: string; id: string; version: string | null }[];
      }>();
      expect(objects.map((o) => [o.op, o.version])).toEqual([
        ["create", "1"],
        ["update", "2"],
        ["delete", null],
      ]);
      expect(objects[0]?.id).toMatch(/^map_[a-z0-9]{16}$/);
      const rows = (
        await as("bob", { method: "GET", url: `/api/projects/${p}/entities/mapping` })
      ).json<{ id: string; value: Row }[]>();
      expect(rows.map((r) => r.id)).not.toContain(row(2).id);
      expect(rows.find((r) => r.id === row(1).id)?.value.code).toBe("R-901");
    });

    it("keeps nothing when one change is stale, and names only that one", async () => {
      const p = await project();
      await put("ada", p, { ...row(1), code: "R-802" }, "1");
      const response = await batch("bob", p, [
        {
          op: "update",
          kind: "mapping",
          id: row(0).id,
          value: { ...row(0), code: "R-805" },
          readVersion: "1",
        },
        {
          op: "update",
          kind: "mapping",
          id: row(1).id,
          value: { ...row(1), code: "R-806" },
          readVersion: "1",
        },
      ]);
      expect(response.statusCode).toBe(409);
      expect(response.json<{ conflicts: { id: string }[] }>().conflicts.map((c) => c.id)).toEqual([
        row(1).id,
      ]);
      const first = await as("bob", {
        method: "GET",
        url: `/api/projects/${p}/entities/mapping/${row(0).id}`,
      });
      expect(first.json()).toMatchObject({ version: "1", value: { code: row(0).code } });
    });

    it("keeps nothing when the result is not schema-valid", async () => {
      const p = await project();
      const response = await batch("bob", p, [
        {
          op: "update",
          kind: "mapping",
          id: row(0).id,
          value: { ...row(0), code: "R-807" },
          readVersion: "1",
        },
        {
          op: "update",
          kind: "mapping",
          id: row(1).id,
          value: { ...row(1), transform: { kind: "nope" } },
          readVersion: "1",
        },
      ]);
      expect(response.statusCode).toBe(422);
      const first = await as("bob", {
        method: "GET",
        url: `/api/projects/${p}/entities/mapping/${row(0).id}`,
      });
      expect(first.json()).toMatchObject({ version: "1" });
    });

    it("checks the permissions and the shape of every change", async () => {
      const p = await project();
      const update = {
        op: "update",
        kind: "mapping",
        id: row(0).id,
        value: row(0),
        readVersion: "1",
      };
      expect((await batch("eve", p, [update])).statusCode).toBe(403);
      const settings = {
        op: "update",
        kind: "project",
        id: p,
        value: motu.project,
        readVersion: "1",
      };
      expect((await batch("bob", p, [settings])).statusCode).toBe(403);
      for (const bad of [
        [],
        [{ ...update, readVersion: undefined }],
        [{ ...update, extra: true }],
        [{ op: "delete", kind: "project", id: p, readVersion: "1" }],
        [{ ...update, readVersion: 1 }],
      ])
        expect([bad, (await batch("ada", p, bad)).statusCode]).toEqual([bad, 400]);
    });
  });
});
