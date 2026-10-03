import { builtinModules } from "node:module";
import { defineConfig } from "electron-vite";
import { globalExternals, MAIN_GLOBALS, RENDERER_GLOBALS } from "./global-externals";

export interface ExtensionConfigOptions {
  mainEntry?: string;
  rendererEntry?: string;
}

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

export function defineExtensionConfig(options: ExtensionConfigOptions = {}) {
  const { mainEntry = "src/main/index.ts", rendererEntry = "src/renderer/index.tsx" } = options;

  const define = {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  };

  return defineConfig({
    main: {
      define,
      plugins: [globalExternals(MAIN_GLOBALS)],
      build: cjsLib(mainEntry, "out/main"),
    },

    // Renderer built in the `preload` slot: the `renderer` slot demands an index.html.
    preload: {
      define,
      plugins: [globalExternals(RENDERER_GLOBALS)],
      build: cjsLib(rendererEntry, "out/renderer"),
    },
  });
}
