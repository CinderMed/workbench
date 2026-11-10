export interface WebConfig {
  oidcAuthority: string;
  oidcClientId: string;
}

type Env = Readonly<Record<string, string | boolean | undefined>>;

const text = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** OIDC settings, fixed at build time (Vite env); defaults match Docker Compose. */
export function readWebConfig(env: Env): WebConfig {
  return {
    oidcAuthority: text(env["VITE_OIDC_AUTHORITY"]) ?? "http://localhost:8081/realms/cindermed",
    oidcClientId: text(env["VITE_OIDC_CLIENT_ID"]) ?? "cindermed-web",
  };
}
