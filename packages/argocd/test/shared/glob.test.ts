import { describe, expect, it } from "vitest";

import { compileGlob, globMatches } from "../../src/renderer/api/shared/glob";

describe("matching a name against a glob", () => {
  it.each([
    ["image-updates", "image-updates", true],
    ["legacy-*", "legacy-annotations", true],
    ["legacy-*", "legacy", false],
    ["image-?pdates", "image-updates", true],
    ["[a-h]*", "guestbook", true],
    ["[^a-h]*", "guestbook", false],
    ["\\*", "*", true],
    ["\\*", "a", false],
    ["*", "team/app", false],
  ])("reads %s against %s as Go's filepath.Match does", (pattern, name, expected) => {
    expect(globMatches(pattern, name)).toBe(expected);
  });

  it("matches nothing with a pattern Go would reject", () => {
    expect(globMatches("image-updates-[", "image-updates-a")).toBe(false);
    expect(globMatches("trailing\\", "trailing")).toBe(false);
  });

  it("compiles each pattern once, and remembers a malformed one as matching nothing", () => {
    expect(compileGlob("legacy-*")).toBe(compileGlob("legacy-*"));
    expect(compileGlob("image-updates-[")).toBeNull();
    expect(globMatches("image-updates-[", "image-updates-a")).toBe(false);
    expect(globMatches("legacy-*", "legacy-annotations")).toBe(true);
  });
});
