import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Separate entry: no app routes, Supabase client, credentials or generated route tree.
export default defineConfig({
  root: "frontend-preview",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 4175, fs: { allow: ["."] } },
  build: { outDir: "../dist/frontend-preview", emptyOutDir: true },
});
