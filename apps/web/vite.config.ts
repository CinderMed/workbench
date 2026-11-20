import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { FHIR_INDEX_DIR, fhirIndex } from "./vite-fhir-index";
import { LOCALHOST, localhostOnly } from "./vite-localhost";

export default defineConfig({
  plugins: [
    react(),
    localhostOnly(),
    fhirIndex(fileURLToPath(new URL(FHIR_INDEX_DIR, import.meta.url))),
  ],
  server: {
    host: LOCALHOST,
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
  preview: { host: LOCALHOST, port: 4173, strictPort: true },
});
