import { builtinModules } from "node:module";
import { defineConfig } from "electron-vite";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./vite/global-externals";

// For a repository with no shared build config; otherwise re-export that one and delete `vite/`.

const runtimeExternals = [
  "electron",
  /^electron\//,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

function cjsLib(entry: string, outDir: string) {
  return {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry,
      formats: ["cjs" as const],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: runtimeExternals,
      output: {
        // Freelens requires exactly one file per entrypoint.
        inlineDynamicImports: true,
        // Freelens reads `.default`; "auto" emits `module.exports = Class` and the
        // extension is skipped without an error.
        exports: "named" as const,
      },
    },
  };
}

export default defineConfig({
  main: {
    plugins: [globalExternals(MAIN_GLOBALS)],
    build: cjsLib("src/main/index.ts", "out/main"),
  },

  // Renderer built in the `preload` slot: the `renderer` slot demands an index.html.
  preload: {
    plugins: [globalExternals(RENDERER_GLOBALS)],
    build: cjsLib("src/renderer/index.tsx", "out/renderer"),
  },
});
