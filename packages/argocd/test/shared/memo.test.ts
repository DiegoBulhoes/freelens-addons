import { describe, expect, it } from "vitest";

import type { Application } from "../../src/renderer/api/applications/application";
import { rememberLast, sameElements } from "../../src/renderer/api/shared/memo";
import { applications, variantOf } from "../support/fixtures";

describe("remembering the last answer", () => {
  const names = rememberLast((list: Application[], suffix = "") =>
    list.map((each) => `${each.getName()}${suffix}`),
  );

  it("answers again from memory for the same objects in a fresh array", () => {
    const all = applications();
    const first = names(all, "");

    expect(names([...all], "")).toBe(first);
  });

  it("answers anew for a changed argument that is not an array", () => {
    const all = applications();
    const first = names(all, "");

    expect(names(all, "!")).not.toBe(first);
    expect(names(all, "!")[0]).toMatch(/!$/);
  });

  it("answers anew when an optional argument is left out after being given", () => {
    const all = applications();
    const exclaimed = names(all, "!");

    expect(names(all)).not.toBe(exclaimed);
    expect(names(all)[0]).not.toMatch(/!$/);
  });

  it("answers anew when an object in the array was replaced", () => {
    const all = applications();
    const first = names(all, "");
    const renamed = variantOf("guestbook", (data) => {
      data.metadata.name = "renamed";
    });

    expect(names([renamed, ...all.slice(1)], "")).not.toBe(first);
  });

  it("compares arrays by length and element, not by identity", () => {
    const all = applications();

    expect(sameElements(all, [...all])).toBe(true);
    expect(sameElements(all, all.slice(1))).toBe(false);
    expect(sameElements(all.slice(0, -1), all)).toBe(false);
    expect(sameElements(all, [...all].reverse())).toBe(false);
  });
});
