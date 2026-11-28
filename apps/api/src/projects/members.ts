/**
 * Members and roles (A2, #19): `GET /me`, the members of a project, invitations by email, role
 * changes and removal. Changing members needs the `manage` permission (owners); a project always
 * keeps at least one owner. Invitations wait until a user with that verified email signs in
 * (`userOf`): there is no mail server in the MVP.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { User } from "../auth.js";
import type { Db } from "../db/connect.js";
import type { MemberRole } from "../db/schema.js";
import { ROLES, allow } from "../permissions.js";
import { ProblemError, notFound } from "../problem.js";

function caller(request: FastifyRequest): User {
  const user = request.user;
  if (user === undefined) throw new Error("the authentication hook did not run");
  return user;
}

const roleBody = {
  type: "object",
  required: ["role"],
  additionalProperties: false,
  properties: { role: { type: "string", enum: ROLES } },
} as const;

/**
 * The check of a typical email field: one `@`, something before it, a domain with a dot that is
 * neither first nor last, and no spaces. Plain string checks: no regular expression to backtrack.
 */
export function isEmail(text: string): boolean {
  const at = text.indexOf("@");
  if (at <= 0 || at !== text.lastIndexOf("@") || /\s/.test(text)) return false;
  const domain = text.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1 && !domain.startsWith(".");
}

const lastOwner = () =>
  new ProblemError({
    code: "last-owner",
    status: 409,
    title: "A project keeps at least one owner",
    detail: "Make another member an owner first.",
  });

export function memberRoutes(app: FastifyInstance, db: Db): void {
  app.get(
    "/api/me",
    { schema: { summary: "The caller and the projects they belong to" } },
    async (request) => {
      const user = caller(request);
      const projects = await db
        .selectFrom("project_members")
        .innerJoin("projects", "projects.id", "project_members.project_id")
        .select(["projects.id", "projects.settings", "project_members.role"])
        .where("project_members.user_id", "=", user.id)
        .orderBy("projects.created_at")
        .execute();
      return {
        user: { id: user.id, name: user.name, email: user.email },
        projects: projects.map((p) => ({ id: p.id, name: p.settings["name"], role: p.role })),
      };
    },
  );

  app.get<{ Params: { p: string } }>(
    "/api/projects/:p/members",
    { schema: { summary: "The members of a project and the invitations waiting" } },
    async (request) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "read");
      const members = await db
        .selectFrom("project_members")
        .innerJoin("users", "users.id", "project_members.user_id")
        .select(["users.id", "users.name", "users.email", "project_members.role"])
        .where("project_members.project_id", "=", p)
        .orderBy("users.name")
        .execute();
      const invitations = await db
        .selectFrom("invitations")
        .select(["email", "role"])
        .where("project_id", "=", p)
        .orderBy("email")
        .execute();
      return { members, invitations };
    },
  );

  app.post<{ Params: { p: string }; Body: { email: string; role: MemberRole } }>(
    "/api/projects/:p/invitations",
    {
      schema: {
        summary: "Invite someone by email, with a role",
        body: {
          type: "object",
          required: ["email", "role"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 320 }, role: roleBody.properties.role },
        },
      },
    },
    async (request, reply) => {
      const { p } = request.params;
      const user = caller(request);
      await allow(db, p, user, "manage");
      const email = request.body.email.trim().toLowerCase();
      if (!isEmail(email))
        throw new ProblemError({
          code: "invalid-email",
          status: 422,
          title: "Not an email address",
          detail: "Give the email address the person signs in with.",
        });
      const { role } = request.body;
      // Someone who has already signed in with that verified email becomes a member at once.
      const known = await db
        .selectFrom("users")
        .select("id")
        .where((eb) => eb(eb.fn("lower", ["email"]), "=", email))
        .where("email_verified", "=", true)
        .executeTakeFirst();
      if (known !== undefined) {
        const added = await db
          .insertInto("project_members")
          .values({ project_id: p, user_id: known.id, role })
          .onConflict((oc) => oc.doNothing())
          .returning("user_id")
          .executeTakeFirst();
        if (added === undefined)
          throw new ProblemError({
            code: "already-member",
            status: 409,
            title: "Already a member",
            detail: "This person is already a member: change their role instead.",
          });
        return reply.status(201).send({ member: { id: known.id, role } });
      }
      await db
        .insertInto("invitations")
        .values({ project_id: p, email, role, invited_by: user.id })
        .onConflict((oc) => oc.columns(["project_id", "email"]).doUpdateSet({ role }))
        .execute();
      return reply.status(202).send({ invitation: { email, role } });
    },
  );

  app.delete<{ Params: { p: string; email: string } }>(
    "/api/projects/:p/invitations/:email",
    { schema: { summary: "Withdraw an invitation" } },
    async (request, reply) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "manage");
      const gone = await db
        .deleteFrom("invitations")
        .where("project_id", "=", p)
        .where("email", "=", request.params.email.toLowerCase())
        .executeTakeFirst();
      if (gone.numDeletedRows === 0n) throw notFound("no such invitation");
      return reply.status(204).send();
    },
  );

  app.put<{ Params: { p: string; u: string }; Body: { role: MemberRole } }>(
    "/api/projects/:p/members/:u",
    { schema: { summary: "Change a member's role", body: roleBody } },
    async (request) => {
      const { p, u } = request.params;
      await allow(db, p, caller(request), "manage");
      const { role } = request.body;
      return db.transaction().execute(async (trx) => {
        const owners = await trx
          .selectFrom("project_members")
          .select(["user_id", "role"])
          .where("project_id", "=", p)
          .forUpdate()
          .execute();
        const current = owners.find((m) => m.user_id === u);
        if (current === undefined) throw notFound("no such member");
        if (
          current.role === "owner" &&
          role !== "owner" &&
          owners.filter((m) => m.role === "owner").length === 1
        )
          throw lastOwner();
        await trx
          .updateTable("project_members")
          .set({ role })
          .where("project_id", "=", p)
          .where("user_id", "=", u)
          .execute();
        return { id: u, role };
      });
    },
  );

  app.delete<{ Params: { p: string; u: string } }>(
    "/api/projects/:p/members/:u",
    { schema: { summary: "Remove a member" } },
    async (request, reply) => {
      const { p, u } = request.params;
      const user = caller(request);
      // Anyone may leave a project; removing someone else needs `manage`.
      await allow(db, p, user, u === user.id ? "read" : "manage");
      await db.transaction().execute(async (trx) => {
        const members = await trx
          .selectFrom("project_members")
          .select(["user_id", "role"])
          .where("project_id", "=", p)
          .forUpdate()
          .execute();
        const current = members.find((m) => m.user_id === u);
        if (current === undefined) throw notFound("no such member");
        if (current.role === "owner" && members.filter((m) => m.role === "owner").length === 1)
          throw lastOwner();
        await trx
          .deleteFrom("project_members")
          .where("project_id", "=", p)
          .where("user_id", "=", u)
          .execute();
      });
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { p: string } }>(
    "/api/projects/:p",
    { schema: { summary: "Delete a project, with all its objects" } },
    async (request, reply) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "manage");
      await db.deleteFrom("projects").where("id", "=", p).execute();
      return reply.status(204).send();
    },
  );
}
