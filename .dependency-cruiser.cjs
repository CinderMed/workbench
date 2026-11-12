// Package boundaries (ADR-0001). Checked in CI with `pnpm boundaries`.
const DOMAIN = "^packages/(model|fhir-defs|fml|normalizer|export)/";
const NODE_IO =
  "^(node:)?(fs|fs/promises|net|http|http2|https|dgram|dns|dns/promises|tls|child_process|cluster|worker_threads|readline|repl|vm|inspector)$";
const IO_LIBRARIES = "(^|/)node_modules/(pg|kysely|undici|node-fetch|axios|ws|ioredis|fastify)/";

// The grammar check of @cindermed/fml: its subpath (resolved or not), its sources and the antlr4ng runtime.
const FML_GRAMMAR =
  "^@cindermed/fml/grammar$|^packages/fml/(src|dist)/grammar(-check)?\\.|^packages/fml/src/grammar/|(^|/)antlr4ng($|/)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "packages-not-to-apps",
      comment: "Packages never import apps/* (ADR-0001).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "domain-no-node-io",
      comment: "Domain packages do no network or file-system I/O (ADR-0001).",
      severity: "error",
      from: { path: DOMAIN },
      to: { dependencyTypes: ["core"], path: NODE_IO },
    },
    {
      name: "domain-no-io-libraries",
      comment: "Domain packages do not use database or HTTP libraries (ADR-0001).",
      severity: "error",
      from: { path: DOMAIN },
      to: { path: IO_LIBRARIES },
    },
    {
      name: "web-not-to-api",
      comment: "The web app talks to the API over HTTP only.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^apps/api/" },
    },
    {
      name: "web-no-fml-grammar",
      comment:
        "The FML grammar check runs in the backend only: apps/web never loads the parser or antlr4ng (ADR-0008).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: FML_GRAMMAR },
    },
    {
      name: "web-no-export",
      comment:
        "The export package carries the grammar check, so it runs in the backend only: apps/web never imports @cindermed/export (ADR-0012).",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^@cindermed/export$|^packages/export/" },
    },
    {
      name: "fml-root-without-grammar",
      comment:
        "The @cindermed/fml root entry never reaches the grammar check; it is exported from @cindermed/fml/grammar (ADR-0008).",
      severity: "error",
      from: { path: "^packages/fml/src/index\\.ts$" },
      to: { path: FML_GRAMMAR, reachable: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // apps/docs (Astro) imports virtual astro:* modules and is outside the ADR-0001 boundaries.
    exclude: { path: "(^|/)(dist|node_modules|\\.astro)/|^apps/docs/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
