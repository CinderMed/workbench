export interface ServerConfig {
  host: string;
  port: number;
  /** PostgreSQL connection string; without it the API serves only health and docs. */
  databaseUrl?: string;
}

/** Reads the listening address from the environment (defaults suit Docker Compose). */
export function readServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const port = Number(env["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env["PORT"] ?? ""}"`);
  }
  const databaseUrl = env["DATABASE_URL"];
  return {
    host: env["HOST"] ?? "0.0.0.0",
    port,
    ...(databaseUrl === undefined || databaseUrl === "" ? {} : { databaseUrl }),
  };
}
