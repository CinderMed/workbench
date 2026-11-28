-- Members and roles (A2, #19). Invitations by email: there is no mail server in the MVP, so an
-- invitation waits until a user whose identity provider has verified that email signs in.

ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
CREATE INDEX users_email ON users (lower(email)) WHERE email_verified;

CREATE TABLE invitations (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- Lower case, compared with the verified email of a signing-in user.
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('owner', 'mapper', 'reviewer', 'engineer', 'viewer')),
  invited_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, email)
);
