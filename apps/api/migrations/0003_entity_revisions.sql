-- History as infrastructure (#220, specification "Data and persistence"): every write keeps the
-- state it leaves each object in, with author, date and kind of change. The history and restore
-- UI (A7) is V2; a restore will be a new write with the old data.

CREATE TABLE entity_revisions (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- The entity kinds, and `project` for the settings.
  kind text NOT NULL CHECK (kind IN ('project', 'source', 'column', 'sourceRelation', 'instance', 'mapping', 'valueMap')),
  id text NOT NULL,
  version bigint NOT NULL,
  change text NOT NULL CHECK (change IN ('import', 'create', 'update', 'delete')),
  -- The object as the write left it; NULL for a deletion.
  data jsonb,
  author uuid NOT NULL REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT now(),
  -- A deletion keeps the version it deleted, so it cannot share the key of that version.
  PRIMARY KEY (project_id, kind, id, version, change)
);

CREATE INDEX entity_revisions_object ON entity_revisions (project_id, kind, id, at DESC);
