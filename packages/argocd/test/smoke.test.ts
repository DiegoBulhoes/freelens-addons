import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";
import { applications, appProjects, events, nodes } from "./fixtures";

describe("the fixtures load through the real classes", () => {
  it("builds every Application", () => {
    const all = applications();

    expect(all.length).toBeGreaterThan(1);
    expect(all[0]).toBeInstanceOf(Application);
    expect(all[0]?.getName()).toBeTruthy();
  });

  it("builds the other kinds", () => {
    expect(appProjects().length).toBeGreaterThan(0);
    expect(nodes().length).toBeGreaterThan(0);
    expect(events().length).toBeGreaterThan(0);
  });
});
