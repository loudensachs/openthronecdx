import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@client": path.resolve(__dirname, "src/client"),
      "@render": path.resolve(__dirname, "src/render"),
      "@shared": path.resolve(__dirname, "src/shared"),
      "@server": path.resolve(__dirname, "src/server"),
      "@skirmish": path.resolve(__dirname, "src/skirmish")
    }
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
