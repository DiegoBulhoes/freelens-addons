import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/**
 * Freelens does not resolve `@freelensapp/extensions` — or React, or MobX — as
 * modules an extension can require. It assigns them to globals on the process
 * it loads the extension into:
 *
 *   main:     LensExtensions ({ Main, Common }), Mobx, Pty
 *   renderer: LensExtensions ({ Renderer, Common }), Mobx, MobxReact, React,
 *             ReactDOM, ReactJsxRuntime, ReactRouter, ReactRouterDom
 *
 * Bundling our own copy of any of these is worse than a bigger file: React and
 * MobX are singletons shared with the host, so a second instance breaks hooks
 * and observability in ways that surface far from the cause. These imports are
 * rewritten to read the host's globals instead.
 *
 * The approach follows freelensapp/freelens-example-extension, with one
 * correction: that repo maps react-dom to `global.ReactDom`, but the name the
 * host actually exports is `ReactDOM`. The misspelling resolves to undefined at
 * runtime, which only bites an extension that imports react-dom.
 */

const PREFIX = "\0freelens-global:";

export const MAIN_GLOBALS: Readonly<Record<string, string>> = {
  "@freelensapp/extensions": "LensExtensions",
  mobx: "Mobx",
};

export const RENDERER_GLOBALS: Readonly<Record<string, string>> = {
  "@freelensapp/extensions": "LensExtensions",
  mobx: "Mobx",
  "mobx-react": "MobxReact",
  react: "React",
  "react-dom": "ReactDOM",
  "react/jsx-runtime": "ReactJsxRuntime",
  "react-router": "ReactRouter",
  "react-router-dom": "ReactRouterDom",
};

// createRequire rather than `require`, so this works whether the config is
// evaluated as ESM or bundled to CJS first. cwd is the package being built.
const requireFrom = createRequire(join(process.cwd(), "__resolve__.cjs"));

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Valid object keys that cannot be re-exported as `export const <name>`.
const RESERVED = new Set([
  "default",
  "__esModule",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function packageNameOf(id: string): string {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
}

/**
 * Locate a module on disk.
 *
 * Plain resolution covers most of it. The fallback exists for packages that are
 * only present in pnpm's virtual store — in a workspace that store sits at the
 * repo root rather than next to the package being built, so this walks up.
 */
function resolveEntry(id: string): string | null {
  try {
    return requireFrom.resolve(id);
  } catch {
    // fall through to the virtual store
  }

  const name = packageNameOf(id);
  const prefix = `${name.replace(/\//g, "+")}@`;

  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const store = join(dir, "node_modules", ".pnpm");

    if (existsSync(store)) {
      for (const entry of readdirSync(store)
        .filter((e) => e.startsWith(prefix))
        .sort()) {
        const base = join(store, entry, "node_modules", name);
        try {
          return createRequire(join(dirname(base), "__resolve__.cjs")).resolve(id);
        } catch {
          // try the next candidate
        }
      }
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
  }
}

/**
 * Read export names out of a bundle without executing it. Some host packages
 * (@freelensapp/extensions among them) run browser-only code on require and
 * cannot be loaded in Node at build time.
 */
function namesFromSource(source: string): string[] {
  const found = new Set<string>();

  // webpack harmony exports: __webpack_require__.d(exports, { Name: () => ... })
  for (const block of source.matchAll(
    /__webpack_require__\.d\(\s*\w+\s*,\s*\{([\s\S]*?)\}\s*\)/g,
  )) {
    for (const match of (block[1] ?? "").matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)) {
      if (match[1]) found.add(match[1]);
    }
  }

  // plain CJS
  for (const match of source.matchAll(/exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)) {
    if (match[1]) found.add(match[1]);
  }
  for (const match of source.matchAll(
    /Object\.defineProperty\(\s*exports\s*,\s*["']([A-Za-z_$][A-Za-z0-9_$]*)["']/g,
  )) {
    if (match[1]) found.add(match[1]);
  }

  return [...found];
}

/**
 * Discover the names to re-export, from the copy installed as a devDependency.
 *
 * They cannot be read off the global: that object only exists once Freelens is
 * running. Discovering them from disk keeps the module graph static without a
 * hand-maintained list going stale.
 */
function exportNamesOf(id: string): string[] {
  const usable = (names: string[]) => names.filter((n) => IDENTIFIER.test(n) && !RESERVED.has(n));
  const entry = resolveEntry(id);

  try {
    const names = usable(Object.keys(requireFrom(entry ?? id)));
    if (names.length > 0) return names;
  } catch {
    // the module refuses to load outside a browser; parse it instead
  }

  if (entry) {
    try {
      return usable(namesFromSource(readFileSync(entry, "utf8")));
    } catch {
      // unreadable; fall through
    }
  }

  return [];
}

export function globalExternals(globals: Readonly<Record<string, string>>): Plugin {
  const cache = new Map<string, string>();

  return {
    name: "freelens-global-externals",
    enforce: "pre",

    // Annotated because Plugin's hooks are declared as unions of function and
    // object forms, and TypeScript does not propagate the parameter type through
    // that union.
    resolveId(id: string) {
      return Object.hasOwn(globals, id) ? { id: `${PREFIX}${id}`, moduleSideEffects: false } : null;
    },

    load(id: string) {
      if (!id.startsWith(PREFIX)) return null;

      const moduleId = id.slice(PREFIX.length);
      let code = cache.get(moduleId);

      if (code === undefined) {
        const globalName = globals[moduleId] as string;
        const names = exportNamesOf(moduleId);

        code = [
          `const __m = globalThis[${JSON.stringify(globalName)}];`,
          // Naming the missing global beats a property read on undefined
          // surfacing somewhere unrelated.
          `if (__m === undefined) {`,
          `  throw new Error(${JSON.stringify(
            `Freelens did not provide global.${globalName}, needed for "${moduleId}". ` +
              `Is this bundle loaded in the process it was built for?`,
          )});`,
          `}`,
          `export default __m;`,
          ...names.map((name) => `export const ${name} = __m.${name};`),
        ].join("\n");

        cache.set(moduleId, code);
      }

      return { code, moduleSideEffects: false };
    },
  };
}
