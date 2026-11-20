import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** Where `cindermed fhir-index --out apps/web/.fhir-index` writes the index (git-ignored). */
export const FHIR_INDEX_DIR = ".fhir-index";
/** The URL path the local mode loads the index from. */
export const FHIR_INDEX_PATH = "/fhir-index/";

/**
 * Serves the compact FHIR definition index (ADR-0013) to the local mode (ADR-0021): JSON files of
 * one folder, nothing else, never outside it. Missing files are 404: build the index with
 * `cindermed fhir-index`.
 */
export function serveFhirIndex(dir: string) {
  const root = resolve(dir);
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = request.url ?? "";
    if (!url.startsWith(FHIR_INDEX_PATH)) {
      next();
      return;
    }
    let relative: string;
    try {
      relative = decodeURIComponent(url.slice(FHIR_INDEX_PATH.length).split("?")[0] ?? "");
    } catch {
      // A malformed escape (URIError) is a bad request, never an unhandled rejection.
      response.statusCode = 400;
      response.end();
      return;
    }
    const file = resolve(root, relative);
    const inside = file.startsWith(root + sep);
    if (request.method !== "GET" || !inside || !file.endsWith(".json")) {
      response.statusCode = 404;
      response.end();
      return;
    }
    try {
      const text = await readFile(file, "utf8");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(text);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  };
}

/** The dev server plugin: only `vite dev` (apply: serve), never part of a build. */
export function fhirIndex(dir: string): Plugin {
  return {
    name: "cindermed-fhir-index",
    apply: "serve",
    configureServer(server) {
      const serve = serveFhirIndex(dir);
      server.middlewares.use((request, response, next) => {
        void serve(request, response, next);
      });
    },
  };
}
