import { builtinModules } from "node:module";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";

const RUNTIME = new Set([
  "electron",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

// docs/security.md lets a transitive advisory only warn because a bundle carries nothing but the
// extension's own src/ and the host's globals. This checks what rollup actually built, which a
// source map can leave out: inline workers, JSON, CSS reached by @import or url(), a plugin's
// virtual module, and a require() left for the user's Freelens to resolve.
export function firstPartyOnly(): Plugin {
  let root = "";
  let src = "";

  return {
    name: "freelens-first-party-only",
    configResolved(config) {
      root = config.root;
      src = resolve(root, "src") + sep;
    },
    generateBundle(_options, bundle) {
      const foreign: string[] = [];

      for (const [file, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") {
          // A chunk's own source map is the one asset allowed.
          const map =
            file.endsWith(".map") && bundle[file.slice(0, -".map".length)]?.type === "chunk";

          if (!map) foreign.push(file);
          continue;
        }

        for (const id of Object.keys(output.modules)) {
          const [path = ""] = id.split("?");

          if (path.startsWith("\0freelens-global:")) continue;
          // A worker is built apart, with a graph of its own this check would not see.
          if (!path.startsWith(src) || /[?&](shared)?worker\b/.test(id)) {
            foreign.push(id.replace("\0", "\\0"));
          }
        }

        for (const imported of [...output.imports, ...output.dynamicImports]) {
          if (!RUNTIME.has(imported) && !imported.startsWith("electron/")) {
            foreign.push(`require("${imported}")`);
          }
        }
      }

      for (const file of this.getWatchFiles()) {
        if (
          !file.startsWith(src) &&
          !file.startsWith("\0") &&
          file !== resolve(root, "package.json")
        ) {
          foreign.push(file);
        }
      }

      if (foreign.length > 0) {
        this.error(`the bundle would carry code from outside src/: ${foreign.join(", ")}`);
      }
    },
  };
}
