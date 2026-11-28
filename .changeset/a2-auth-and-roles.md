---
"@cindermed/api": minor
---

Sign-in and project roles (A2, #19, ADR-0027). The API checks each request's Keycloak access token: signature with the realm's keys, issuer, expiry and the web client. Every project route enforces the specification's permissions for the five roles. Non-members get 404 and members without the permission get 403. New routes: `GET /api/me`; the members of a project, with role changes, removal (always one owner left) and leaving; invitations by email, accepted when a user with that verified email signs in (no email is sent); and project deletion by owners. New settings: `OIDC_JWKS_URL`, where the realm's keys are fetched, and `TRUST_PROXY`, the proxies whose forwarded address the rate limit counts.
