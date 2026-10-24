import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base "./" permite publicar en cualquier subcarpeta (por ejemplo GitHub Pages)
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
});
