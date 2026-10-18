import { describe, expect, it } from "vitest";
import { getParentOf } from "../../src/renderer/api/applications/insights";
import { deriveOverview, overviewMinute } from "../../src/renderer/api/overview/dashboard";
import {
  getAttentionItems,
  getCounts,
  STALE_RECONCILE_MINUTES,
} from "../../src/renderer/api/overview/overview";
import { rememberLast } from "../../src/renderer/api/shared/memo";
import { applications, appProjects, fixtureNow, variantOf } from "../support/fixtures";

const NOW = overviewMinute(fixtureNow());
const MINUTE = 60_000;

describe("what the overview derives from the whole fleet", () => {
  it("agrees with each derivation run on its own", () => {
    const all = applications();
    const derived = deriveOverview(all, appProjects(), NOW);

    expect(derived.counts).toEqual(getCounts(all, appProjects()));
    expect(derived.attention.map((item) => item.application)).toEqual(
      getAttentionItems(all, NOW).map((item) => item.application),
    );
    expect(derived.criticalCount).toBe(
      derived.attention.filter((item) => item.severity === "critical").length,
    );

    for (const application of all) {
      expect(derived.parents.parentOf(application)).toBe(getParentOf(application, all));
    }
  });

  it("reads the clock to the minute, so keystrokes within one minute agree on it", () => {
    expect(overviewMinute(NOW + 59_999)).toBe(NOW);
    expect(overviewMinute(NOW + MINUTE)).toBe(NOW + MINUTE);
  });
});

describe("the overview between two keystrokes", () => {
  it("reuses everything while the store holds the same Applications", () => {
    const derive = rememberLast(deriveOverview);
    const all = applications();
    const projects = appProjects();
    const first = derive(all, projects, NOW);

    expect(derive([...all], [...projects], NOW)).toBe(first);
  });

  it("derives again once the store replaces an Application", () => {
    const derive = rememberLast(deriveOverview);
    const all = applications();
    const projects = appProjects();
    const first = derive(all, projects, NOW);
    const index = all.findIndex((each) => each.getName() === "guestbook");
    const degraded = variantOf("guestbook", (data) => {
      (data.status as { health: { status: string } }).health.status = "Degraded";
    });
    const replaced = all.map((each, at) => (at === index ? degraded : each));
    const again = derive(replaced, projects, NOW);

    expect(again).not.toBe(first);
    expect(again.attention.map((item) => item.application)).toContain(degraded);
  });

  it("derives again when the store changes its own array in place", () => {
    const derive = rememberLast(deriveOverview);
    const all = applications();
    const projects = appProjects();
    const first = derive(all, projects, NOW);

    all.pop();

    expect(derive(all, projects, NOW)).not.toBe(first);
  });

  it("notices an Application the controller stopped reconciling once the minute moves on", () => {
    const derive = rememberLast(deriveOverview);
    const all = applications();
    const projects = appProjects();
    const named = (now: number) =>
      derive(all, projects, now).attention.find(
        (item) => item.application.getName() === "guestbook",
      );

    expect(named(NOW)).toBeUndefined();
    expect(named(NOW + (STALE_RECONCILE_MINUTES + 1) * MINUTE)?.headline).toBe("Not reconciled");
  });
});
