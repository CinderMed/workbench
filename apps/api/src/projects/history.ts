/**
 * The history of an object (#220, specification "REST API"): every state a write left it in,
 * newest first, with its author, date and kind of change. A deletion keeps the version it
 * deleted, with no value. History is infrastructure in module 4; its UI and restore (A7) are V2.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { User } from "../auth.js";
import type { Db } from "../db/connect.js";
import type { EntityKind } from "../db/schema.js";
import { allow } from "../permissions.js";
import { notFound } from "../problem.js";

const KINDS = ["source", "column", "sourceRelation", "instance", "mapping", "valueMap"] as const;
const LIMIT = { type: "string", pattern: "^[1-9][0-9]{0,3}$" } as const;

function caller(request: FastifyRequest): User {
  const user = request.user;
  if (user === undefined) throw new Error("the authentication hook did not run");
  return user;
}

async function history(
  db: Db,
  projectId: string,
  kind: EntityKind | "project",
  id: string,
  limit: number,
) {
  const rows = await db
    .selectFrom("entity_revisions")
    .innerJoin("users", "users.id", "entity_revisions.author")
    .select([
      "entity_revisions.version",
      "entity_revisions.change",
      "entity_revisions.data",
      "entity_revisions.at",
      "users.id as authorId",
      "users.name as authorName",
    ])
    .where("entity_revisions.project_id", "=", projectId)
    .where("entity_revisions.kind", "=", kind)
    .where("entity_revisions.id", "=", id)
    // Newest first; a deletion comes after the version it deleted.
    .orderBy("entity_revisions.at", "desc")
    .orderBy("entity_revisions.version", "desc")
    .orderBy((eb) => eb.case().when("entity_revisions.change", "=", "delete").then(0).else(1).end())
    .limit(limit)
    .execute();
  if (rows.length === 0) throw notFound(`no history for ${kind} ${id}`);
  return {
    kind,
    id,
    revisions: rows.map((r) => ({
      version: r.version,
      change: r.change,
      at: r.at.toISOString(),
      author: { id: r.authorId, name: r.authorName },
      value: r.data,
    })),
  };
}

export function historyRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { p: string; kind: EntityKind; id: string }; Querystring: { limit?: string } }>(
    "/api/projects/:p/entities/:kind/:id/history",
    {
      schema: {
        summary: "The history of an object, newest first",
        params: {
          type: "object",
          required: ["p", "kind", "id"],
          properties: {
            p: { type: "string" },
            kind: { type: "string", enum: KINDS },
            id: { type: "string" },
          },
        },
        querystring: { type: "object", additionalProperties: false, properties: { limit: LIMIT } },
      },
    },
    async (request) => {
      const { p, kind, id } = request.params;
      await allow(db, p, caller(request), "read");
      return history(db, p, kind, id, Number(request.query.limit ?? "100"));
    },
  );

  app.get<{ Params: { p: string }; Querystring: { limit?: string } }>(
    "/api/projects/:p/history",
    {
      schema: {
        summary: "The history of the project settings, newest first",
        querystring: { type: "object", additionalProperties: false, properties: { limit: LIMIT } },
      },
    },
    async (request) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "read");
      return history(db, p, "project", p, Number(request.query.limit ?? "100"));
    },
  );
}
