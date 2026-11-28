# ADR-0027: Sign-in with Keycloak tokens, and project roles in the database

- Status: accepted
- Date: 2026-11-28
- Module: 4 (Platform)
- Issue: #19

## Context

The specification gives identity to Keycloak (OIDC, authorization code with PKCE) and keeps roles per project in the database. It also fixes the five roles and their permissions ("Permissions"). The API verifies JWTs with the realm's public key. The module 4 plan, approved on 2026-11-27, adds `jose` for that check, and invitations matched by email at sign-in, because the MVP has no mail server.

## Decision

- **Token check (`tokenAuthenticate`).** Each request's `Authorization: Bearer` access token is checked with `jose`:
  - RS256 signature against the realm's JWKS, fetched and cached by `createRemoteJWKSet`;
  - issuer `OIDC_ISSUER`;
  - expiry, with 5 s of clock tolerance;
  - `azp`, which must be the web client `OIDC_CLIENT_ID`. Without an audience mapper, Keycloak doesn't name the API in `aud`, so `azp` is the client check.

  A missing or bad token is no caller (401). A token that can't be checked, because the keys can't be fetched, is also 401, and is logged by error name only, never with the token.

- **Keys inside Docker Compose.** Tokens name the browser's address as issuer (`localhost:8081`), but the API reaches Keycloak at `keycloak:8080`. So `OIDC_JWKS_URL` is a setting of its own, defaulting to the issuer's certificate endpoint.
- **Callers.**
  - A caller gets a `users` row on first sight, with name and email kept current.
  - The `email_verified` claim is stored too.
  - Without `OIDC_ISSUER`, every caller is refused, and the API logs a warning.
- **Permissions** (`permissions.ts`). The specification's table becomes actions: `read`, `comment`, `edit`, `approve`, `expert`, `export` and `manage`, the last for settings and members. Every project route names its action.
  - A caller who isn't a member gets 404, as if the project didn't exist.
  - A member without the permission gets 403, with their role.
  - Importing a project needs only a signed-in caller, who becomes its owner.
- **Members.**
  - `GET /me`;
  - `GET /projects/{p}/members` lists members and the invitations waiting;
  - `PUT` and `DELETE /projects/{p}/members/{u}`, which need `manage`, except that anyone may leave a project;
  - a project always keeps one owner: removing or demoting the last owner is 409 (`last-owner`);
  - `DELETE /projects/{p}` (owners).
- **Invitations** (`POST` and `DELETE /projects/{p}/invitations…`).
  - The owner gives an email and a role.
  - Someone who has already signed in with that **verified** email becomes a member at once.
  - Otherwise the invitation waits, and is accepted when a user whose identity provider has verified that email signs in.
  - No email is sent. An unverified email never accepts an invitation, so nobody can claim one by typing someone else's address into their profile.
- **Rate limit behind the proxy.** In Docker Compose every request reaches the API through the web container, so the per-address rate limit (ADR-0026) would be one limit for everyone. `TRUST_PROXY` lists the proxies whose `X-Forwarded-For` is trusted (`uniquelocal` in Compose).

## Alternatives considered

- **Roles as Keycloak client roles.** Identity and authorization would live in one place, but a role is per project, and projects live in the database. The specification keeps Keycloak to identity.
- **Checking `aud` with an audience mapper in the realm.** That's stricter, but it would change the realm import, and `azp` already ties the token to the client. It can be added later without changing the API.
- **Sending invitation emails.** That needs a mail server and its credentials; the module 4 plan defers it.

## Consequences

- The Docker Compose smoke test signs in as a realm test user, exchanges the code for a token, calls `GET /api/me` through the web proxy, and checks that the same call without a token is refused.
- The approve permission is defined, but it's enforced only when the status workflow arrives (A5, module 4 branch 7).
