import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { Db } from "../db/connect.js";
import type { MemberRole } from "../db/schema.js";
import { PERMISSIONS, ROLES } from "../permissions.js";
import { testAuthenticate, testDb, withDatabase } from "../test-support/test-db.js";

const motu = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../../fixtures/fml-examples/motu/project.json"),
    "utf8",
  ),
) as { project: Record<string, unknown>; mappings: { id: string }[] };

describe.skipIf(!withDatabase)("members and roles (#19)", () => {
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
  const me = async (who: string) =>
    (await as(who, { method: "GET", url: "/api/me" })).json<{
      user: { id: string; email: string };
      projects: { id: string; role: string }[];
    }>();
  let counter = 0;
  /** A MOTU project owned by `owner`, with the given members added by invitation. */
  const project = async (owner: string, members: Record<string, MemberRole> = {}) => {
    counter += 1;
    const id = `prj_roles${String(counter).padStart(3, "0")}`;
    const created = await as(owner, {
      method: "POST",
      url: "/api/projects:import",
      payload: { ...motu, project: { ...motu.project, id } },
    });
    expect(created.statusCode).toBe(201);
    for (const [who, role] of Object.entries(members)) {
      await me(who); // signed in once: a known, verified user
      const invited = await as(owner, {
        method: "POST",
        url: `/api/projects/${id}/invitations`,
        payload: { email: `${who}@example.org`, role },
      });
      expect(invited.statusCode).toBe(201);
    }
    return id;
  };

  it("lists the caller and their projects", async () => {
    const p = await project("ada", { bob: "viewer" });
    const bob = await me("bob");
    expect(bob.user.email).toBe("bob@example.org");
    expect(bob.projects).toContainEqual(expect.objectContaining({ id: p, role: "viewer" }));
  });

  it("enforces the specification's permissions for every role", async () => {
    const roles: Record<string, MemberRole> = {
      bob: "mapper",
      cy: "reviewer",
      dee: "engineer",
      eve: "viewer",
    };
    const p = await project("ada", {});
    // eve's email is not verified, so she joins by role change after an owner adds her directly.
    for (const [who, role] of Object.entries(roles)) {
      const { user } = await me(who);
      await db
        .insertInto("project_members")
        .values({ project_id: p, user_id: user.id, role })
        .execute();
    }
    const people: Record<MemberRole, string> = {
      owner: "ada",
      mapper: "bob",
      reviewer: "cy",
      engineer: "dee",
      viewer: "eve",
    };
    const row = motu.mappings[0];
    for (const role of ROLES) {
      const who = people[role];
      const read = await as(who, { method: "GET", url: `/api/projects/${p}/entities/mapping` });
      expect(read.statusCode).toBe(200);
      const version = read
        .json<{ id: string; version: string }[]>()
        .find((m) => m.id === row?.id)?.version;
      const edit = await as(who, {
        method: "PUT",
        url: `/api/projects/${p}/entities/mapping/${row?.id ?? ""}`,
        headers: { "if-match": `"${version ?? ""}"` },
        payload: { value: row },
      });
      expect([role, edit.statusCode]).toEqual([role, PERMISSIONS.edit.includes(role) ? 200 : 403]);
      const exported = await as(who, {
        method: "POST",
        url: `/api/projects/${p}/exports`,
        payload: { format: "json" },
      });
      expect([role, exported.statusCode]).toEqual([
        role,
        PERMISSIONS.export.includes(role) ? 200 : 403,
      ]);
      const current = (await as(who, { method: "GET", url: `/api/projects/${p}` })).json<{
        version: string;
      }>();
      const settings = await as(who, {
        method: "PATCH",
        url: `/api/projects/${p}`,
        headers: { "if-match": `"${current.version}"` },
        payload: {},
      });
      expect([role, settings.statusCode]).toEqual([role, role === "owner" ? 200 : 403]);
    }
    const refused = await as("cy", {
      method: "PATCH",
      url: `/api/projects/${p}`,
      headers: { "if-match": '"1"' },
      payload: {},
    });
    expect(refused.json()).toMatchObject({ code: "forbidden", status: 403, role: "reviewer" });
  });

  it("keeps an invitation until a user with that verified email signs in", async () => {
    const p = await project("ada");
    const invited = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/invitations`,
      payload: { email: " Newcomer@Example.org ", role: "mapper" },
    });
    expect(invited.statusCode).toBe(202);
    expect(invited.json()).toEqual({
      invitation: { email: "newcomer@example.org", role: "mapper" },
    });
    const listed = (await as("ada", { method: "GET", url: `/api/projects/${p}/members` })).json<{
      members: { role: string }[];
      invitations: { email: string; role: string }[];
    }>();
    expect(listed.invitations).toEqual([{ email: "newcomer@example.org", role: "mapper" }]);

    // An unverified email is not enough.
    await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/invitations`,
      payload: { email: "eve@example.org", role: "viewer" },
    });
    expect((await me("eve")).projects.map((x) => x.id)).not.toContain(p);

    // The withdrawn invitation is gone; a bad address is refused.
    expect(
      (await as("ada", { method: "DELETE", url: `/api/projects/${p}/invitations/eve@example.org` }))
        .statusCode,
    ).toBe(204);
    const bad = await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/invitations`,
      payload: { email: "not an email", role: "viewer" },
    });
    expect(bad.json()).toMatchObject({ code: "invalid-email", status: 422 });
    expect((await as("bob", { method: "GET", url: `/api/projects/${p}/members` })).statusCode).toBe(
      404,
    );
  });

  it("accepts the waiting invitation at sign-in", async () => {
    const p = await project("ada");
    await as("ada", {
      method: "POST",
      url: `/api/projects/${p}/invitations`,
      payload: { email: "dee@example.org", role: "engineer" },
    });
    // dee signs in (again): the invitation becomes a membership.
    expect((await me("dee")).projects).toContainEqual(
      expect.objectContaining({ id: p, role: "engineer" }),
    );
    const listed = (await as("ada", { method: "GET", url: `/api/projects/${p}/members` })).json<{
      invitations: unknown[];
    }>();
    expect(listed.invitations).toEqual([]);
  });

  it("changes roles and removes members, always keeping an owner", async () => {
    const p = await project("ada", { bob: "mapper" });
    const ada = (await me("ada")).user.id;
    const bob = (await me("bob")).user.id;
    const demote = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/members/${ada}`,
      payload: { role: "viewer" },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ code: "last-owner" });
    expect(
      (await as("ada", { method: "DELETE", url: `/api/projects/${p}/members/${ada}` })).statusCode,
    ).toBe(409);

    // A mapper cannot change roles; an owner can.
    expect(
      (
        await as("bob", {
          method: "PUT",
          url: `/api/projects/${p}/members/${bob}`,
          payload: { role: "owner" },
        })
      ).statusCode,
    ).toBe(403);
    const promoted = await as("ada", {
      method: "PUT",
      url: `/api/projects/${p}/members/${bob}`,
      payload: { role: "owner" },
    });
    expect(promoted.json()).toEqual({ id: bob, role: "owner" });
    expect(
      (
        await as("ada", {
          method: "PUT",
          url: `/api/projects/${p}/members/${ada}`,
          payload: { role: "viewer" },
        })
      ).statusCode,
    ).toBe(200);
    // Anyone may leave.
    expect(
      (await as("ada", { method: "DELETE", url: `/api/projects/${p}/members/${ada}` })).statusCode,
    ).toBe(204);
    expect((await me("ada")).projects.map((x) => x.id)).not.toContain(p);
    const already = await as("bob", {
      method: "POST",
      url: `/api/projects/${p}/invitations`,
      payload: { email: "bob@example.org", role: "viewer" },
    });
    expect(already.json()).toMatchObject({ code: "already-member", status: 409 });
  });

  it("deletes a project with its objects, for an owner only", async () => {
    const p = await project("ada", { bob: "mapper" });
    expect((await as("bob", { method: "DELETE", url: `/api/projects/${p}` })).statusCode).toBe(403);
    expect((await as("ada", { method: "DELETE", url: `/api/projects/${p}` })).statusCode).toBe(204);
    expect((await as("ada", { method: "GET", url: `/api/projects/${p}` })).statusCode).toBe(404);
    const left = await db.selectFrom("entities").select("id").where("project_id", "=", p).execute();
    expect(left).toEqual([]);
  });
});
