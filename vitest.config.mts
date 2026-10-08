import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  // tests cover the markup math, so they run with a $10 markup
  test: { environment: "node", fileParallelism: false, env: { MARKUP_DOLLARS: "10" } },
});
