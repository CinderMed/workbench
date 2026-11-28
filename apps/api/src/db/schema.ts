/**
 * The tables, as Kysely sees them (migrations/0001_projects_and_entities.sql). JSONB columns are
 * read as parsed values and written as JSON text.
 */
import type { ColumnType, Generated } from "kysely";

/** A JSONB column: read as a value, written as JSON text. */
type Json<T> = ColumnType<T, string, string>;
/** A bigint column: pg returns it as a string. */
type Version = ColumnType<string, string | number | undefined, string | number>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

export type MemberRole = "owner" | "mapper" | "reviewer" | "engineer" | "viewer";

/** The kinds stored in `entities`; the project settings live in `projects`. */
export type EntityKind =
  "source" | "column" | "sourceRelation" | "instance" | "mapping" | "valueMap";

/** What the project file holds besides its objects. */
export interface ProjectMeta {
  /** The file's `$schema` reference, if it had one. */
  readonly schema?: string;
  readonly formatVersion: string;
  readonly templates?: unknown[];
  readonly extensions?: Record<string, unknown>;
  /** Top-level collections the file had even when empty, so it is written back the same way. */
  readonly collections: readonly string[];
}

export interface Database {
  users: {
    id: Generated<string>;
    sub: string;
    name: string;
    email: string;
    email_verified: ColumnType<boolean, boolean | undefined, boolean>;
    created_at: CreatedAt;
  };
  invitations: {
    project_id: string;
    email: string;
    role: MemberRole;
    invited_by: string;
    created_at: CreatedAt;
  };
  projects: {
    id: string;
    settings: Json<Record<string, unknown>>;
    meta: Json<ProjectMeta>;
    version: Version;
    created_by: string;
    created_at: CreatedAt;
    updated_at: UpdatedAt;
  };
  project_members: {
    project_id: string;
    user_id: string;
    role: MemberRole;
  };
  entities: {
    project_id: string;
    kind: EntityKind;
    id: string;
    parent_id: string | null;
    position: number;
    version: Version;
    data: Json<Record<string, unknown>>;
    updated_by: string;
    updated_at: UpdatedAt;
  };
  entity_revisions: {
    project_id: string;
    kind: EntityKind | "project";
    id: string;
    version: Version;
    change: "import" | "create" | "update" | "delete";
    data: ColumnType<Record<string, unknown> | null, string | null, never>;
    author: string;
    at: CreatedAt;
  };
  schema_migrations: {
    name: string;
    applied_at: CreatedAt;
  };
}
