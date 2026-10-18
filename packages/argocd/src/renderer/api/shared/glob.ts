const compiledGlobs = new Map<string, RegExp | null>();

/** Go's `filepath.Match`, as the controller uses it: `*` and `?` stop at `/`. Malformed matches nothing. */
export function globMatches(pattern: string, name: string): boolean {
  return compileGlob(pattern)?.test(name) ?? false;
}

/** Compiled once per pattern; null for a malformed one. */
export function compileGlob(pattern: string): RegExp | null {
  let compiled = compiledGlobs.get(pattern);

  if (compiled === undefined) {
    compiled = globToRegExp(pattern);
    compiledGlobs.set(pattern, compiled);
  }

  return compiled;
}

function globToRegExp(pattern: string): RegExp | null {
  let source = "";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] as string;

    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "\\") {
      const next = pattern[++index];

      if (next === undefined) return null;
      source += escapeRegExp(next);
    } else if (char === "[") {
      const end = pattern.indexOf("]", index + 2);

      if (end === -1) return null;

      const body = pattern.slice(index + 1, end);
      source += `[${body.startsWith("^") ? `^/${escapeClass(body.slice(1))}` : escapeClass(body)}]`;
      index = end;
    } else source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeClass(body: string): string {
  return body.replace(/[\]\\]/g, "\\$&");
}
