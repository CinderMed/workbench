/**
 * Project routes (specification, "REST API", #219): import and JSON export of a project file (H3),
 * the project settings, and its objects one by one. Every route checks the caller's role in the
 * project (`allow`, specification "Permissions").
 */
import {
  type Change,
  type ProjectFile,
  objectKey,
  parseProject,
  serializeProject,
} from "@cindermed/model";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "../auth.js";
import type { Db } from "../db/connect.js";
import type { EntityKind } from "../db/schema.js";
import { allow } from "../permissions.js";
import { ProblemError, notFound, sendProblem } from "../problem.js";
import { type WriteResult, importProject, loadProject, newId, writeChanges } from "./repository.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated caller (set by the app's authentication hook). */
    user?: User;
  }
}

const ENTITY_KINDS: readonly EntityKind[] = [
  "source",
  "column",
  "sourceRelation",
  "instance",
  "mapping",
  "valueMap",
];

const kindParam = {
  type: "object",
  required: ["p", "kind"],
  properties: { p: { type: "string" }, kind: { type: "string", enum: ENTITY_KINDS } },
} as const;
const objectParam = {
  type: "object",
  required: ["p", "kind", "id"],
  properties: { ...kindParam.properties, id: { type: "string" } },
} as const;

function caller(request: FastifyRequest): User {
  const user = request.user;
  if (user === undefined) throw new Error("the authentication hook did not run");
  return user;
}

/** The objects of one kind in a file, with their parent for columns. */
function objectsOf(
  file: ProjectFile,
  kind: EntityKind,
): { value: unknown; id: string; parentId?: string }[] {
  switch (kind) {
    case "source":
      return file.sources.map((s) => {
        const copy: Record<string, unknown> = { ...s };
        delete copy["columns"];
        return { id: s.id, value: copy };
      });
    case "column":
      return file.sources.flatMap((s) =>
        s.columns.map((c) => ({ id: c.id, value: c, parentId: s.id })),
      );
    case "sourceRelation":
      return (file.sourceRelations ?? []).map((r) => ({ id: r.id, value: r }));
    case "instance":
      return file.instances.map((i) => ({ id: i.id, value: i }));
    case "mapping":
      return file.mappings.map((m) => ({ id: m.id, value: m }));
    case "valueMap":
      return file.valueMaps.map((v) => ({ id: v.id, value: v }));
  }
}

/** Answers a refused write with its problem. */
function writeProblem(result: Exclude<WriteResult, { ok: true }>): ProblemError {
  switch (result.reason) {
    case "noProject":
      return notFound("no such project");
    case "invalid":
      return new ProblemError({
        code: "invalid-project",
        status: 422,
        title: "The project would not match the schema",
        detail: "The change is refused: the project after it would not match the project schema.",
        results: result.results,
      });
    case "missing":
      return notFound(result.message);
    case "exists":
      return new ProblemError({
        code: "already-exists",
        status: 409,
        title: "The object already exists",
        detail: result.message,
      });
    case "refused":
      return new ProblemError({
        code: "change-refused",
        status: 422,
        title: "The change is refused",
        detail: result.message,
      });
  }
}

export function projectRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    "/api/projects::import",
    { schema: { summary: "New project from a project file (H3)", body: { type: "object" } } },
    async (request, reply) => {
      const parsed = parseProject(JSON.stringify(request.body));
      const errors = parsed.results.filter((r) => r.severity === "error");
      if (parsed.project === undefined || errors.length > 0)
        return sendProblem(reply, {
          code: "invalid-project-file",
          status: 422,
          title: "The project file is not valid",
          detail: "The file does not match the project schema, or cannot be migrated.",
          results: errors,
        });
      const id = await importProject(db, caller(request), parsed.project);
      return reply.status(201).header("location", `/api/projects/${id}`).send({ id });
    },
  );

  app.get(
    "/api/projects",
    { schema: { summary: "The projects the caller is a member of" } },
    async (request) => {
      const rows = await db
        .selectFrom("projects")
        .innerJoin("project_members", "project_members.project_id", "projects.id")
        .select(["projects.id", "projects.settings", "projects.version", "project_members.role"])
        .where("project_members.user_id", "=", caller(request).id)
        .orderBy("projects.created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.settings["name"],
        fhirVersion: r.settings["fhirVersion"],
        role: r.role,
        version: r.version,
      }));
    },
  );

  app.get<{ Params: { p: string } }>(
    "/api/projects/:p",
    { schema: { summary: "The project settings" } },
    async (request) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "read");
      const stored = await loadProject(db, p);
      if (stored === undefined) throw notFound(`no project ${p}`);
      return {
        id: p,
        version: stored.versions.get(objectKey("project", p)),
        settings: stored.file.project,
      };
    },
  );

  app.patch<{ Params: { p: string }; Body: Record<string, unknown> }>(
    "/api/projects/:p",
    { schema: { summary: "Change the project settings", body: { type: "object" } } },
    async (request) => {
      const { p } = request.params;
      const user = caller(request);
      await allow(db, p, user, "manage");
      const stored = await loadProject(db, p);
      if (stored === undefined) throw notFound(`no project ${p}`);
      const value = { ...stored.file.project, ...request.body, id: p };
      const result = await writeChanges(db, p, user, [
        { op: "update", kind: "project", id: p, value },
      ]);
      if (!result.ok) throw writeProblem(result);
      return { id: p, version: result.versions.get(objectKey("project", p)), settings: value };
    },
  );

  app.post<{ Params: { p: string }; Body: { format?: string } }>(
    "/api/projects/:p/exports",
    {
      schema: {
        summary: "Export the project",
        body: {
          type: "object",
          required: ["format"],
          properties: { format: { type: "string", enum: ["json"] } },
        },
      },
    },
    async (request, reply: FastifyReply) => {
      const { p } = request.params;
      await allow(db, p, caller(request), "export");
      const stored = await loadProject(db, p);
      if (stored === undefined) throw notFound(`no project ${p}`);
      return reply
        .type("application/json")
        .header("content-disposition", `attachment; filename="${p}.json"`)
        .send(serializeProject(stored.file));
    },
  );

  app.get<{ Params: { p: string; kind: EntityKind } }>(
    "/api/projects/:p/entities/:kind",
    { schema: { summary: "The objects of one kind", params: kindParam } },
    async (request) => {
      const { p, kind } = request.params;
      await allow(db, p, caller(request), "read");
      const stored = await loadProject(db, p);
      if (stored === undefined) throw notFound(`no project ${p}`);
      return objectsOf(stored.file, kind).map((o) => ({
        kind,
        ...o,
        version: stored.versions.get(objectKey(kind, o.id)),
      }));
    },
  );

  app.get<{ Params: { p: string; kind: EntityKind; id: string } }>(
    "/api/projects/:p/entities/:kind/:id",
    { schema: { summary: "One object", params: objectParam } },
    async (request) => {
      const { p, kind, id } = request.params;
      await allow(db, p, caller(request), "read");
      const stored = await loadProject(db, p);
      const found =
        stored === undefined ? undefined : objectsOf(stored.file, kind).find((o) => o.id === id);
      if (stored === undefined || found === undefined) throw notFound(`no ${kind} ${id}`);
      return { kind, ...found, version: stored.versions.get(objectKey(kind, id)) };
    },
  );

  app.post<{
    Params: { p: string; kind: EntityKind };
    Body: { value: Record<string, unknown>; parentId?: string };
  }>(
    "/api/projects/:p/entities/:kind",
    {
      schema: {
        summary: "Create an object (the server gives it an id when the value has none)",
        params: kindParam,
        body: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "object" }, parentId: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { p, kind } = request.params;
      const user = caller(request);
      await allow(db, p, user, "edit");
      const id =
        typeof request.body.value["id"] === "string" ? request.body.value["id"] : newId(kind);
      const value = { ...request.body.value, id };
      const change = {
        op: "create",
        kind,
        value,
        ...(request.body.parentId === undefined ? {} : { parentId: request.body.parentId }),
      } as Change;
      const result = await writeChanges(db, p, user, [change]);
      if (!result.ok) throw writeProblem(result);
      return reply
        .status(201)
        .header("location", `/api/projects/${p}/entities/${kind}/${id}`)
        .send({ kind, id, value, version: result.versions.get(objectKey(kind, id)) });
    },
  );

  app.put<{
    Params: { p: string; kind: EntityKind; id: string };
    Body: { value: Record<string, unknown> };
  }>(
    "/api/projects/:p/entities/:kind/:id",
    {
      schema: {
        summary: "Replace an object",
        params: objectParam,
        body: { type: "object", required: ["value"], properties: { value: { type: "object" } } },
      },
    },
    async (request) => {
      const { p, kind, id } = request.params;
      const user = caller(request);
      await allow(db, p, user, "edit");
      const value = request.body.value;
      const result = await writeChanges(db, p, user, [{ op: "update", kind, id, value } as Change]);
      if (!result.ok) throw writeProblem(result);
      return { kind, id, value, version: result.versions.get(objectKey(kind, id)) };
    },
  );

  app.delete<{ Params: { p: string; kind: EntityKind; id: string } }>(
    "/api/projects/:p/entities/:kind/:id",
    { schema: { summary: "Delete an object", params: objectParam } },
    async (request, reply) => {
      const { p, kind, id } = request.params;
      const user = caller(request);
      await allow(db, p, user, "edit");
      const result = await writeChanges(db, p, user, [{ op: "delete", kind, id }]);
      if (!result.ok) throw writeProblem(result);
      return reply.status(204).send();
    },
  );
}
