import { describe, expect, it } from "vitest";

import {
  describeHeadline,
  describeOverviewState,
  getOverviewState,
  type StoreFacts,
} from "../src/renderer/api/store-state";

/**
 * Not knowing and knowing there is nothing look identical on this page, and
 * only one of them deserves a quiet screen. The host's `loadAll` never
 * rejects — it empties the store and sets a flag — so an unreachable cluster
 * arrives as a store that exists and holds nothing.
 */

const facts = (over: Partial<StoreFacts> = {}): StoreFacts => ({
  registered: true,
  loaded: false,
  failed: false,
  itemCount: 0,
  gaveUp: false,
  ...over,
});

describe("deciding whether the page knows anything", () => {
  it("is ready once a load has finished", () => {
    expect(getOverviewState(facts({ loaded: true, itemCount: 57 }))).toBe("ready");
  });

  it("is ready when a load finished and the cluster really has none", () => {
    expect(getOverviewState(facts({ loaded: true, itemCount: 0 }))).toBe("ready");
    expect(describeHeadline("ready", 0, 0)).toBe("No ArgoCD Applications found");
  });

  it("says the CRD is absent rather than that the cluster is broken", () => {
    expect(getOverviewState(facts({ registered: false }))).toBe("not-installed");
    expect(describeOverviewState("not-installed")).toContain("No ArgoCD Applications");
  });

  it("says unreachable once the retries are spent with nothing to show", () => {
    expect(getOverviewState(facts({ failed: true, gaveUp: true }))).toBe("unreachable");
    expect(describeOverviewState("unreachable")).toContain("Could not read");
  });

  it("never states a count it cannot stand behind", () => {
    for (const state of ["not-installed", "connecting", "unreachable"] as const) {
      const headline = describeHeadline(state, 0, 0);

      expect(headline).not.toMatch(/\d+ of \d+/);
      expect(headline).not.toContain("synced and healthy");
    }
  });
});

describe("deciding during a normal startup", () => {
  it("is connecting while the retry budget is unspent, even after a failure", () => {
    // The first attempts routinely fail while the cluster connects; that is the
    // whole reason the budget exists. Calling it unreachable would light an
    // alarm on every launch.
    expect(getOverviewState(facts({ failed: true, gaveUp: false }))).toBe("connecting");
  });

  it("does not alarm before the first attempt has even run", () => {
    expect(getOverviewState(facts())).toBe("connecting");
    expect(describeOverviewState("connecting")).toBe("Connecting to the cluster…");
  });

  it("goes ready the moment items arrive, whatever happened before", () => {
    expect(getOverviewState(facts({ failed: true, gaveUp: true, itemCount: 12 }))).toBe("ready");
  });

  it("gives no note at all once it is ready, so the page is quiet when it should be", () => {
    expect(describeOverviewState("ready")).toBeUndefined();
  });
});

describe("deciding from facts that contradict each other", () => {
  it("trusts loaded over failed, a later success replacing an earlier failure", () => {
    expect(getOverviewState(facts({ loaded: true, failed: true }))).toBe("ready");
  });

  it("calls an unregistered store not-installed however else it looks", () => {
    expect(
      getOverviewState(facts({ registered: false, loaded: true, itemCount: 9, gaveUp: true })),
    ).toBe("not-installed");
  });

  it("does not call a store unreachable while it still holds items", () => {
    expect(getOverviewState(facts({ failed: true, gaveUp: true, itemCount: 1 }))).toBe("ready");
  });

  it("counts attention against the total it was given, not against itself", () => {
    expect(describeHeadline("ready", 4, 57)).toBe("4 of 57 Applications need attention");
    expect(describeHeadline("ready", 0, 57)).toBe("All 57 Applications are synced and healthy");
  });
});
