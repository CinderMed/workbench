import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ProjectFile, parseProject, serializeProject } from "@cindermed/model";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { Db } from "../db/connect.js";
import { testAuthenticate, testDb, withDatabase } from "../test-support/test-db.js";

const FIXTURES = resolve(import.meta.dirname, "../../../../fixtures/fml-examples");
const EXAMPLES = readdirSync(FIXTURES).filter((name) => {
  try {
    readFileSync(join(FIXTURES, name, "project.json"));
    return true;
  } catch {
    return false;
  }
});
const fixtureText = (name: string) => readFileSync(join(FIXTURES, name, "project.json"), "utf8");
const fixture = (name: string): ProjectFile => {
  const parsed = parseProject(fixtureText(name)).project;
  if (parsed === undefined) throw new Error(`${name} is not valid`);
  return parsed;
};

describe.skipIf(!withDatabase)("project routes on PostgreSQL (#219)", () => {
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

  const as = (who: string | undefined, options: InjectOptions) =>
    app.inject({
      ...options,
      headers: { ...options.headers, ...(who ? { "x-test-user": who } : {}) },
    });
  const importAs = async (who: string, project: unknown) => {
    const response = await as(who, {
      method: "POST",
      url: "/api/projects:import",
      payload: project as object,
    });
    return { response, id: response.json<{ id: string }>().id };
  };
  const exported = async (who: string, id: string) =>
    as(who, { method: "POST", url: `/api/projects/${id}/exports`, payload: { format: "json" } });

  it("answers 401 without a caller, except health and docs", async () => {
    const response = await as(undefined, { method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ code: "unauthenticated", status: 401 });
    expect((await as(undefined, { method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await as(undefined, { method: "GET", url: "/api/docs" })).statusCode).toBe(200);
  });

  it.each(EXAMPLES)(
    "stores the %s project object by object and writes it back the same",
    async (name) => {
      const { response, id } = await importAs("ada", JSON.parse(fixtureText(name)));
      expect(response.statusCode).toBe(201);
      const back = await exported("ada", id);
      expect(back.statusCode).toBe(200);
      expect(back.headers["content-disposition"]).toBe(`attachment; filename="${id}.json"`);
      const original = fixture(name);
      // The id is the file's when free; the first import of each fixture keeps it.
      expect(back.body).toBe(
        serializeProject({ ...original, project: { ...original.project, id } }),
      );
    },
  );

  it("gives an imported project a new id when its own is taken, and lists the caller's projects", async () => {
    const first = await importAs("bob", fixture("motu"));
    const second = await importAs("bob", fixture("motu"));
    expect(second.id).not.toBe(first.id);
    expect(second.id).toMatch(/^prj_[a-z0-9]{16}$/);
    const listed = (await as("bob", { method: "GET", url: "/api/projects" })).json<
      { id: string; role: string }[]
    >();
    expect(listed.map((p) => [p.id, p.role])).toEqual([
      [first.id, "owner"],
      [second.id, "owner"],
    ]);
  });

  it("refuses an invalid file with its schema errors", async () => {
    const broken = JSON.parse(fixtureText("metastra")) as Record<string, unknown>;
    delete broken["sources"];
    const { response } = await importAs("ada", broken);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "invalid-project-file",
      results: [expect.objectContaining({ code: "SCHEMA_VIOLATION" })],
    });
  });

  it("shows a project only to its members", async () => {
    const { id } = await importAs("ada", {
      ...fixture("metastra"),
      project: { ...fixture("metastra").project, id: "prj_private1" },
    });
    for (const url of [`/api/projects/${id}`, `/api/projects/${id}/entities/mapping`]) {
      const response = await as("bob", { method: "GET", url });
      expect(response.statusCode).toBe(404);
    }
    expect((await exported("bob", id)).statusCode).toBe(404);
  });

  it("creates, reads, updates and deletes objects, keeping only schema-valid projects", async () => {
    const base = fixture("motu");
    const { id: p } = await importAs("ada", {
      ...base,
      project: { ...base.project, id: "prj_crud001" },
    });
    const row = base.mappings[0];
    if (row === undefined) throw new Error("fixture changed");

    // A new row without an id gets one from the server, version 1, at the end of the list.
    const withoutId: Partial<typeof row> = { ...row };
    delete withoutId.id;
    const created = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/entities/mapping`,
      payload: { value: { ...withoutId, code: "R-900" } },
    });
    expect(created.statusCode).toBe(201);
    const made = created.json<{ id: string; version: string }>();
    expect(made.id).toMatch(/^map_[a-z0-9]{16}$/);
    expect(made.version).toBe("1");
    const rows = (
      await as("ada", { method: "GET", url: `/api/projects/${p}/entities/mapping` })
    ).json<{ id: string; version: string }[]>();
    expect(rows.at(-1)?.id).toBe(made.id);

    // An update gets the next version; the object reads back as written.
    const updated = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/${made.id}`,
      headers: { "if-match": `"${made.version}"` },
      payload: { value: { ...withoutId, id: made.id, code: "R-901" } },
    });
    expect(updated.json()).toMatchObject({ version: "2" });
    const read = await as("ada", {
      method: "GET",
      url: `/api/projects/${p}/entities/mapping/${made.id}`,
    });
    expect(read.json()).toMatchObject({ id: made.id, version: "2", value: { code: "R-901" } });

    // A change that leaves the project schema-invalid is refused, and nothing is kept.
    const invalid = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/${made.id}`,
      headers: { "if-match": '"2"' },
      payload: { value: { ...withoutId, id: made.id, code: "R-901", transform: { kind: "nope" } } },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: "invalid-project",
      results: expect.any(Array) as unknown,
    });
    const unchanged = await as("ada", {
      method: "GET",
      url: `/api/projects/${p}/entities/mapping/${made.id}`,
    });
    expect(unchanged.json()).toMatchObject({ version: "2" });

    // Delete: gone, and a second delete of what was read is a conflict (deleted meanwhile).
    const url = `/api/projects/${p}/entities/mapping/${made.id}`;
    const del = { method: "DELETE" as const, url, headers: { "if-match": '"2"' } };
    expect((await as("ada", del)).statusCode).toBe(204);
    expect((await as("ada", { method: "GET", url })).statusCode).toBe(404);
    const again = await as("ada", del);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      conflicts: [{ kind: "mapping", id: made.id, version: null }],
    });

    // The project still exports as the fixture.
    expect((await exported("ada", p)).body).toBe(
      serializeProject({ ...base, project: { ...base.project, id: p } }),
    );
  });

  it("keeps a table's columns with it: created inside it, refused when the last one goes, deleted with it", async () => {
    const base = fixture("metastra");
    const { id: p } = await importAs("ada", {
      ...base,
      project: { ...base.project, id: "prj_tables01" },
    });
    const table = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/entities/source`,
      payload: {
        value: { name: "extra", columns: [{ id: "col_extra01", name: "a", dataType: "string" }] },
      },
    });
    expect(table.statusCode).toBe(201);
    const source = table.json<{ id: string }>().id;
    const column = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/entities/column`,
      payload: { parentId: source, value: { name: "b", dataType: "string" } },
    });
    expect(column.statusCode).toBe(201);
    const columnId = column.json<{ id: string }>().id;
    const columns = (
      await as("ada", { method: "GET", url: `/api/projects/${p}/entities/column` })
    ).json<{ id: string; parentId: string }[]>();
    expect(columns.filter((c) => c.parentId === source).map((c) => c.id)).toEqual([
      "col_extra01",
      columnId,
    ]);

    const v1 = { "if-match": '"1"' };
    await as("ada", {
      method: "DELETE",
      url: `/api/projects/${p}/entities/column/${columnId}`,
      headers: v1,
    });
    const last = await as("ada", {
      method: "DELETE",
      url: `/api/projects/${p}/entities/column/col_extra01`,
      headers: v1,
    });
    expect(last.statusCode).toBe(422);
    expect(last.json()).toMatchObject({ code: "change-refused" });

    expect(
      (
        await as("ada", {
          method: "DELETE",
          url: `/api/projects/${p}/entities/source/${source}`,
          headers: v1,
        })
      ).statusCode,
    ).toBe(204);
    const left = await db
      .selectFrom("entities")
      .select("id")
      .where("project_id", "=", p)
      .where("parent_id", "=", source)
      .execute();
    expect(left).toEqual([]);
    expect((await exported("ada", p)).body).toBe(
      serializeProject({ ...base, project: { ...base.project, id: p } }),
    );
  });

  it("changes the project settings, keeping its id", async () => {
    const base = fixture("metastra");
    const { id: p } = await importAs("ada", {
      ...base,
      project: { ...base.project, id: "prj_settings" },
    });
    const patched = await as("ada", {
      method: "PATCH",
      url: `/api/projects/${p}`,
      headers: { "if-match": '"1"' },
      payload: { name: "Metastra 2", id: "prj_other" },
    });
    expect(patched.json()).toMatchObject({
      id: p,
      version: "2",
      settings: { name: "Metastra 2", id: p },
    });
    const read = (await as("ada", { method: "GET", url: `/api/projects/${p}` })).json<{
      settings: { name: string };
    }>();
    expect(read.settings.name).toBe("Metastra 2");
  });

  it("answers problems for an unknown kind, a missing object and a duplicate id", async () => {
    const base = fixture("motu");
    const { id: p } = await importAs("ada", {
      ...base,
      project: { ...base.project, id: "prj_problems" },
    });
    const unknownKind = await as("ada", {
      method: "GET",
      url: `/api/projects/${p}/entities/table`,
    });
    expect(unknownKind.statusCode).toBe(400);
    expect(unknownKind.json()).toMatchObject({ code: "bad-request" });
    const missing = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/entities/mapping/map_missing1`,
      headers: { "if-match": '"1"' },
      payload: { value: { id: "map_missing1" } },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ conflicts: [{ id: "map_missing1", version: null }] });
    const row = base.mappings[0];
    const duplicate = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/entities/mapping`,
      payload: { value: row },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "already-exists" });
  });
});
