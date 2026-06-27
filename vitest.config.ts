import { defineConfig } from "vitest/config";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      exclude: ["src/testing/**"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  plugins: [
    // Handle TC39 decorators
    babel({
      presets: [
        {
          preset: () => ({
            plugins: [
              ["@babel/plugin-proposal-decorators", { version: "2023-11" }],
            ],
          }),
          rolldown: { filter: { code: "@" } },
        },
      ],
    }),
  ],
});
