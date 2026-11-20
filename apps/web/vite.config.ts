import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { LOCALHOST, localhostOnly } from "./vite-localhost";

export default defineConfig({
  plugins: [react(), localhostOnly()],
  server: {
    host: LOCALHOST,
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
  preview: { host: LOCALHOST, port: 4173, strictPort: true },
});
