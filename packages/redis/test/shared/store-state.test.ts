import { describe, expect, it } from "vitest";

import {
  afterLoad,
  describeFailures,
  EVERYWHERE,
  failedAmong,
  failedEverywhere,
  failedNamespacesOf,
  inventoryState,
  MAX_LOAD_ATTEMPTS,
  pageNote,
} from "../../src/renderer/api/shared/store-state";

// As the API server words a refused list.
const refusedIn = (namespace: string) =>
  new Error(
    `pods is forbidden: User "viewer" cannot list resource "pods" in API group "" in the namespace "${namespace}"`,
  );

describe("a list refused in some namespace", () => {
  it("names the namespace Kubernetes refused, and counts any other failure against every one", () => {
    expect(failedNamespacesOf(refusedIn("redis"), ["apps", "redis"])).toEqual(["redis"]);
    expect(
      failedNamespacesOf(new Error("list failed", { cause: refusedIn("apps") }), ["apps", "redis"]),
    ).toEqual(["apps"]);
    expect(failedNamespacesOf(new Error("socket hang up"), ["apps", "redis"])).toEqual([
      "apps",
      "redis",
    ]);
    expect(failedNamespacesOf(refusedIn("elsewhere"), ["redis"])).toEqual(["redis"]);
    expect(failedNamespacesOf("timeout", [])).toEqual([EVERYWHERE]);
    expect(failedNamespacesOf(undefined, ["redis"])).toEqual(["redis"]);
  });

  it("tells a namespace refused from the whole scope refused", () => {
    expect(failedEverywhere(new Set(["redis"]), ["apps", "redis"])).toBe(false);
    expect(failedEverywhere(new Set(["apps", "redis"]), ["apps", "redis"])).toBe(true);
    expect(failedEverywhere(new Set([EVERYWHERE]), [])).toBe(true);
    expect(failedEverywhere(new Set(), [])).toBe(false);
    expect(failedAmong(new Set(["redis"]), ["redis"])).toBe(true);
    expect(failedAmong(new Set(["redis"]), ["apps"])).toBe(false);
    expect(failedAmong(new Set([EVERYWHERE]), ["apps"])).toBe(true);
  });

  it("lists a refused namespace again, though the store reads loaded, until the attempts run out", () => {
    expect(afterLoad({ loaded: true, failed: 1, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: true, failed: 0, attempts: 2 })).toBe("done");
    expect(afterLoad({ loaded: false, failed: 0, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: true, failed: 1, attempts: MAX_LOAD_ATTEMPTS })).toBe("give-up");
  });

  it("keeps the page ready when one namespace refused, and names it", () => {
    const loaded = { registered: true, loaded: true, gaveUp: false };
    const partly = failedEverywhere(new Set(["apps"]), ["apps", "redis"]);

    expect(inventoryState([loaded], { ...loaded, failed: partly })).toBe("ready");
    expect(pageNote("ready", { Pods: new Set(["apps"]), Sentinels: new Set() })).toEqual({
      note: "Could not read Pods in apps, so nothing there is judged.",
      alarm: true,
    });
    expect(
      describeFailures({ Replications: new Set([EVERYWHERE]), Pods: new Set(["b", "a"]) }),
    ).toBe(
      "Could not read Replications in every namespace; Pods in a, b, so nothing there is judged.",
    );
    expect(pageNote("ready", {})).toEqual({ note: undefined, alarm: false });
    expect(pageNote("connecting", { Pods: new Set(["apps"]) })).toEqual({
      note: "Connecting to the cluster…",
      alarm: false,
    });
    expect(pageNote("unreachable", {}).alarm).toBe(true);
  });
});
