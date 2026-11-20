import type { Plugin } from "vite";

/** The only address the dev server and the preview server may listen on (ADR-0021). */
export const LOCALHOST = "127.0.0.1";

/**
 * The local mode has no login, so the dev server must never be reachable from another machine
 * (ADR-0021): it is bound to 127.0.0.1, and Vite's host check stays on (`allowedHosts` is never
 * `true`). This plugin stops the server when the resolved configuration says otherwise, also when
 * the address comes from the command line (`vite --host`).
 */
export function localhostOnly(): Plugin {
  return {
    name: "cindermed-localhost-only",
    configResolved(config) {
      for (const [name, server] of [
        ["server", config.server],
        ["preview", config.preview],
      ] as const) {
        if (server.host !== LOCALHOST)
          throw new Error(
            `${name}.host must be ${LOCALHOST}: the local mode has no login and must not be reachable from other machines (ADR-0021), not ${String(server.host)}`,
          );
        if (server.allowedHosts === true)
          throw new Error(
            `${name}.allowedHosts must not be true: Vite's host check stays on (ADR-0021)`,
          );
        if (!server.strictPort) throw new Error(`${name}.strictPort must be true (ADR-0021)`);
      }
    },
  };
}
