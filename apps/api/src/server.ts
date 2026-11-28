import { readFileSync } from "node:fs";
import { createRemoteJWKSet } from "jose";
import { buildApp } from "./app.js";
import { tokenAuthenticate } from "./auth.js";
import { readServerConfig } from "./config.js";
import { connect } from "./db/connect.js";
import { migrate } from "./db/migrate.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const config = readServerConfig(process.env);
const db =
  config.databaseUrl === undefined
    ? undefined
    : await connect({ connectionString: config.databaseUrl });
if (db !== undefined) await migrate(db);

const { oidc } = config;
const app = await buildApp({
  version,
  logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  ...(db === undefined ? {} : { db }),
  ...(config.trustProxy === undefined ? {} : { trustProxy: config.trustProxy }),
  ...(oidc === undefined
    ? {}
    : {
        authenticate: tokenAuthenticate({
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          keys: createRemoteJWKSet(new URL(oidc.jwksUrl)),
        }),
      }),
});
if (db !== undefined && oidc === undefined)
  app.log.warn("OIDC_ISSUER is not set: every project route refuses its callers");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => db?.destroy())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
