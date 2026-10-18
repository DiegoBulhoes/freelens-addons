import { builtinModules } from "node:module";
import { defineConfig } from "electron-vite";
import { firstPartyOnly } from "./first-party-only";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./global-externals";

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
    // Bundled, so build/vite/first-party-only.ts sees and refuses it, not left to a runtime require.
    externalizeDeps: false,
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

export function defineExtensionConfig() {
  return defineConfig({
    main: {
      plugins: [globalExternals(MAIN_GLOBALS), firstPartyOnly()],
      build: cjsLib("src/main/index.ts", "out/main"),
    },

    // Renderer built in the `preload` slot: the `renderer` slot demands an index.html.
    preload: {
      plugins: [globalExternals(RENDERER_GLOBALS), firstPartyOnly()],
      build: cjsLib("src/renderer/index.tsx", "out/renderer"),
    },
  });
}
