// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

const repo = "https://github.com/CinderMed/workbench";

// Deployed to GitHub Pages under /workbench on every release tag (release.yml).
export default defineConfig({
  site: "https://cindermed.github.io",
  base: "/workbench",
  integrations: [
    starlight({
      title: "CinderMed",
      description: "FHIR Mapping Workbench: map tabular datasets to FHIR and generate FML.",
      // English is the source locale; Italian is added later as a translation (ADR-0002).
      defaultLocale: "root",
      locales: { root: { label: "English", lang: "en" } },
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/docs/` },
      sidebar: [
        { label: "Start here", items: ["getting-started"] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
      plugins: [starlightLinksValidator()],
    }),
  ],
});
