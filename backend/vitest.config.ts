import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_SECRET: "test-jwt-secret-key-32-characters-minimum",
      NODE_ENV: "test",
    },
  },
});
