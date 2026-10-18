import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../src/renderer/styles/trivy.css"), "utf8");

// The host redefines these per theme, so a severity reads in both.
const HOST_TONES = ["--colorError", "--colorWarning", "--colorInfo", "--textColorSecondary"];

const tokens = () =>
  [...css.matchAll(/(--trivy-[a-z]+):\s*([^;]+);/g)].map((match) => ({
    name: match[1],
    value: (match[2] ?? "").trim(),
  }));

describe("the severity colours", () => {
  it("are host tokens, never a colour of our own", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
  });

  it("point each severity at one of the host's tones", () => {
    const found = tokens();

    expect(found.map((token) => token.name)).toEqual([
      "--trivy-critical",
      "--trivy-high",
      "--trivy-medium",
      "--trivy-low",
      "--trivy-unknown",
    ]);
    for (const { value } of found) {
      expect(HOST_TONES.map((tone) => `var(${tone})`)).toContain(value);
    }
  });

  it("keep critical, high and medium apart", () => {
    const value = (name: string) => tokens().find((token) => token.name === name)?.value;

    const worst = [value("--trivy-critical"), value("--trivy-high"), value("--trivy-medium")];

    expect(new Set(worst).size).toBe(3);
  });
});
