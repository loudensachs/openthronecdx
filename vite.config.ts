import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@client": path.resolve(__dirname, "src/client"),
      "@render": path.resolve(__dirname, "src/render"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@server": path.resolve(__dirname, "src/server"),
      "@skirmish": path.resolve(__dirname, "src/skirmish")
    }
  },
  build: {
    target: "es2022",
    sourcemap: true
  },
  worker: {
    format: "es"
  },
  server: {
    port: 5173
  }
});
