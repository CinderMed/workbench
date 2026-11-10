// Conventional Commits with the scopes listed in CLAUDE.md and the specification.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "model",
        "fhir-defs",
        "fml",
        "normalizer",
        "export",
        "terminology",
        "api",
        "web",
        "cli",
        "docs",
        "infra",
        "deps",
      ],
    ],
  },
};
