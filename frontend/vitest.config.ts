import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@mock": fileURLToPath(new URL("./mock", import.meta.url)),
    },
  },
  test: {
    // Node by default (the mock layer, the engine, content scans). Component and hook
    // tests opt in to jsdom with a `@vitest-environment jsdom` docblock, so the pure
    // suites never pay for a DOM.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
