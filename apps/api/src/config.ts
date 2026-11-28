export interface ServerConfig {
  host: string;
  port: number;
  /** PostgreSQL connection string; without it the API serves only health and docs. */
  databaseUrl?: string;
  /** Sign-in (#19): without it every caller is refused. */
  oidc?: OidcConfig;
  /**
   * Proxies in front of the API whose `X-Forwarded-For` is trusted (TRUST_PROXY): addresses,
   * ranges or names such as `uniquelocal` (comma-separated). Behind the web proxy every request
   * comes from it, so without this the per-address rate limit would be one limit for everyone.
   * Absent: the TCP peer is the client.
   */
  trustProxy?: string[];
}

export interface OidcConfig {
  /** The realm's issuer, as tokens name it (OIDC_ISSUER). */
  readonly issuer: string;
  /** The web client tokens are issued to (OIDC_CLIENT_ID). */
  readonly clientId: string;
  /**
   * Where the API fetches the realm's public keys (OIDC_JWKS_URL). Default: the issuer's
   * certificate endpoint. In Docker Compose the issuer is the browser's address
   * (localhost:8081) and the API reaches Keycloak at keycloak:8080, so it is set apart.
   */
  readonly jwksUrl: string;
}

/** Reads the listening address from the environment (defaults suit Docker Compose). */
export function readServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const port = Number(env["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env["PORT"] ?? ""}"`);
  }
  const set = (name: string) => {
    const value = env[name];
    return value === undefined || value === "" ? undefined : value;
  };
  const databaseUrl = set("DATABASE_URL");
  const issuer = set("OIDC_ISSUER")?.replace(/\/+$/, "");
  const oidc =
    issuer === undefined
      ? undefined
      : {
          issuer,
          clientId: set("OIDC_CLIENT_ID") ?? "cindermed-web",
          jwksUrl: set("OIDC_JWKS_URL") ?? `${issuer}/protocol/openid-connect/certs`,
        };
  const proxy = set("TRUST_PROXY");
  const trustProxy = proxy
    ?.split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return {
    host: env["HOST"] ?? "0.0.0.0",
    port,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(oidc === undefined ? {} : { oidc }),
    ...(trustProxy === undefined ? {} : { trustProxy }),
  };
}
