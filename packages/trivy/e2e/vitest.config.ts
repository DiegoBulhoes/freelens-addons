import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The harness lives in build/e2e, above vite's root.
const repositoryRoot = resolve(__dirname, "../../..");

export default defineConfig({
  server: {
    fs: { allow: [repositoryRoot] },
  },
  test: {
    include: ["**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One window, one cluster: parallel files would fight over the same UI.
    fileParallelism: false,
  },
});
