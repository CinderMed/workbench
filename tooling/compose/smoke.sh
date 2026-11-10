#!/usr/bin/env bash
# Smoke test of the Docker Compose stack (module 0 "done when": docker compose up shows the Keycloak login).
# Checks: the web app is served; the API answers through the web proxy; Keycloak serves the login page
# for the cindermed-web client; a realm test user can sign in and is sent back to the web app with a code.
# Usage: bash tooling/compose/smoke.sh   (stack already running with the default ports and passwords)
set -euo pipefail

web=${WEB_URL:-http://localhost:8080}
keycloak=${KEYCLOAK_URL:-http://localhost:8081}
user=${SMOKE_USER:-mapper}
password=${CINDERMED_DEV_PASSWORD:-cindermed-dev}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

retry() { # retries a command for up to 3 minutes (Keycloak imports the realm on first start)
  for _ in $(seq 1 90); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done
  "$@"
}

echo "web app"
retry curl -fsS "$web/"
curl -fsS "$web/" | grep -q '<div id="root"></div>'

echo "API through the web proxy"
curl -fsS "$web/api/health" | grep -q '"status":"ok"'

echo "Keycloak login page"
retry curl -fsS "$keycloak/realms/cindermed/.well-known/openid-configuration"
verifier=$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
challenge=$(printf '%s' "$verifier" | openssl dgst -binary -sha256 | base64 | tr '+/' '-_' | tr -d '=\n')
auth="$keycloak/realms/cindermed/protocol/openid-connect/auth?client_id=cindermed-web&response_type=code&scope=openid&redirect_uri=$web/&state=smoke&code_challenge=$challenge&code_challenge_method=S256"
curl -fsS -c "$work/cookies" "$auth" -o "$work/login.html"
grep -q 'id="kc-form-login"' "$work/login.html"
action=$(sed -n 's/.*id="kc-form-login"[^>]*action="\([^"]*\)".*/\1/p' "$work/login.html" | head -n1 | sed 's/&amp;/\&/g')
[ -n "$action" ] || { echo "login form action not found" >&2; exit 1; }

echo "sign-in as $user"
location=$(curl -sS -b "$work/cookies" -o /dev/null -w '%{redirect_url}' \
  --data-urlencode "username=$user" --data-urlencode "password=$password" "$action")
case "$location" in
  "$web/?"*"code="*) echo "redirected back to the web app with an authorization code" ;;
  *) echo "unexpected redirect after sign-in: '$location'" >&2; exit 1 ;;
esac

echo "smoke test passed"
