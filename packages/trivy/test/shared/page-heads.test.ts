import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pages = resolve(__dirname, "../../src/renderer/pages");

describe("the page heads", () => {
  it("each carry the namespace selector, the way out of a namespace that refuses", () => {
    for (const file of readdirSync(pages).filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(resolve(pages, file), "utf8");
      const heads = source.split('className="Trivy-page__head"').length - 1;
      const selectors = source.split("<NamespaceFilter />").length - 1;

      expect(selectors, file).toBe(heads);
    }
  });
});
