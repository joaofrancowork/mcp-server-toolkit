import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
