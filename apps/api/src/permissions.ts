/**
 * What each project role may do (specification, "Permissions", A2, #19). Keycloak manages identity
 * only; roles are per project, in `project_members`, and every project route checks them here.
 */
import type { User } from "./auth.js";
import type { Db } from "./db/connect.js";
import type { MemberRole } from "./db/schema.js";
import { ProblemError, notFound } from "./problem.js";

export type Action = "read" | "comment" | "edit" | "approve" | "expert" | "export" | "manage";

/** The specification's table: action → the roles that may perform it. */
export const PERMISSIONS: Readonly<Record<Action, readonly MemberRole[]>> = {
  /** Read the project. */
  read: ["owner", "mapper", "reviewer", "engineer", "viewer"],
  comment: ["owner", "mapper", "reviewer", "engineer"],
  /** Edit source, roles, rows, maps. */
  edit: ["owner", "mapper", "engineer"],
  /** Set a status to Approved. */
  approve: ["owner", "reviewer"],
  /** Expert expression (D6), FML view. */
  expert: ["owner", "engineer"],
  /** Verify and export. */
  export: ["owner", "mapper", "reviewer", "engineer"],
  /** Settings and members. */
  manage: ["owner"],
};

export const ROLES: readonly MemberRole[] = ["owner", "mapper", "reviewer", "engineer", "viewer"];

export const can = (role: MemberRole, action: Action): boolean =>
  PERMISSIONS[action].includes(role);

/**
 * The caller's role in a project, when it may perform the action. A caller who is not a member
 * gets 404, as if the project did not exist; a member without the permission gets 403.
 */
export async function allow(
  db: Db,
  projectId: string,
  user: User,
  action: Action,
): Promise<MemberRole> {
  const row = await db
    .selectFrom("project_members")
    .select("role")
    .where("project_id", "=", projectId)
    .where("user_id", "=", user.id)
    .executeTakeFirst();
  if (row === undefined) throw notFound(`no project ${projectId}`);
  if (!can(row.role, action))
    throw new ProblemError({
      code: "forbidden",
      status: 403,
      title: "Not allowed",
      detail: `The ${row.role} role cannot ${DESCRIPTIONS[action]} in this project.`,
      role: row.role,
    });
  return row.role;
}

const DESCRIPTIONS: Readonly<Record<Action, string>> = {
  read: "read the project",
  comment: "comment",
  edit: "edit the source, roles, rows or maps",
  approve: "approve",
  expert: "use expert expressions or the FML view",
  export: "verify or export",
  manage: "change the settings or the members",
};
