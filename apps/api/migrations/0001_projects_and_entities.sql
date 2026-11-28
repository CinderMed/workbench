-- Projects and their objects (specification, "Data and persistence", #219).
-- Every object of the project file is a row of `entities`; the file is reassembled on export.
-- No patient data: only dictionaries and mappings.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- OIDC subject of the identity provider (Keycloak).
  sub text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id text PRIMARY KEY,
  -- The `project` block of the project file (name, FHIR version, packages, output, ...).
  settings jsonb NOT NULL,
  -- formatVersion, templates, extensions and the optional collections the file had.
  meta jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'mapper', 'reviewer', 'engineer', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE entities (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('source', 'column', 'sourceRelation', 'instance', 'mapping', 'valueMap')),
  id text NOT NULL,
  -- A column's table; NULL for the other kinds.
  parent_id text,
  -- Order in its list (or, for a column, in its table): new objects go last, gaps are allowed.
  position integer NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  data jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind, id)
);

CREATE INDEX entities_order ON entities (project_id, kind, parent_id, position);
