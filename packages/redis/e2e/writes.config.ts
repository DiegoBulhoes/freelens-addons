import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repositoryRoot = resolve(__dirname, "../../..");

// Real writes on the dev k3s: each file changes the cluster through the UI and puts the seed back.
export default defineConfig({
  server: {
    fs: { allow: [repositoryRoot] },
  },
  test: {
    include: ["**/*.writes.ts"],
    testTimeout: 15 * 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
