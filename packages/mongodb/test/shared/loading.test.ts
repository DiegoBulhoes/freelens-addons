import { afterEach, describe, expect, it, vi } from "vitest";

import {
  afterAgentRead,
  agentKeys,
  agentsError,
  agentViewOf,
  startAgentRead,
} from "../../src/renderer/api/clusters/agent";
import { describeHeadline, replicaSetRows } from "../../src/renderer/api/clusters/rows";
import {
  nextWarnings,
  replicaSetEvents,
  type WarningsRead,
  warningsNote,
} from "../../src/renderer/api/clusters/upkeep";
import { dueReads, FRESH_MS, MAX_READS } from "../../src/renderer/api/shared/polling";
import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";
import { nextReadDelay, RELIST_MS } from "../../src/renderer/api/shared/retry";
import {
  afterLoad,
  EVERYWHERE,
  emptyText,
  failedAmong,
  failedNamespacesOf,
  inventoryState,
  loadState,
  MAX_LOAD_ATTEMPTS,
  podsReadIn,
  worstOf,
} from "../../src/renderer/api/shared/store-state";
import { events, healthOf, inventory, named, pods, replicaSets } from "../support/fixtures";

afterEach(() => {
  vi.useRealTimers();
});

// As the API server words a refused list.
const refusedIn = (namespace: string) =>
  new Error(
    `pods is forbidden: User "viewer" cannot list resource "pods" in API group "" in the namespace "${namespace}"`,
  );

describe("a list refused in some namespace", () => {
  it("names the namespace Kubernetes refused, and counts any other failure against every one", () => {
    expect(failedNamespacesOf(refusedIn("mongodb"), ["apps", "mongodb"])).toEqual(["mongodb"]);
    expect(
      failedNamespacesOf(new Error("list failed", { cause: refusedIn("apps") }), [
        "apps",
        "mongodb",
      ]),
    ).toEqual(["apps"]);
    expect(failedNamespacesOf(new Error("socket hang up"), ["apps", "mongodb"])).toEqual([
      "apps",
      "mongodb",
    ]);
    expect(failedNamespacesOf(refusedIn("elsewhere"), ["mongodb"])).toEqual(["mongodb"]);
    expect(failedNamespacesOf("timeout", [])).toEqual([EVERYWHERE]);
    expect(failedNamespacesOf(undefined, ["mongodb"])).toEqual(["mongodb"]);
  });

  it("reads the refusal the host hands onLoadFailure as its Error's cause, and survives a loop", () => {
    const host = new Error("Failed to load /api/v1/pods", {
      cause: { toString: () => refusedIn("apps").message },
    });
    const looped = new Error("looped") as Error & { cause?: unknown };

    looped.cause = looped;

    expect(failedNamespacesOf(host, ["apps", "mongodb"])).toEqual(["apps"]);
    expect(failedNamespacesOf(looped, ["apps", "mongodb"])).toEqual(["apps", "mongodb"]);
  });

  it("is listed again until every namespace answers or the attempts run out", () => {
    expect(afterLoad({ loaded: true, failed: 0, attempts: 1 })).toBe("done");
    expect(afterLoad({ loaded: true, failed: 1, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: false, failed: 0, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: true, failed: 1, attempts: MAX_LOAD_ATTEMPTS })).toBe("give-up");
  });

  it("reads as unreachable, not ready, though the host marks it loaded", () => {
    const facts = { registered: true, loaded: true, itemCount: 3, gaveUp: false };

    expect(loadState(facts)).toBe("ready");
    expect(loadState({ ...facts, failed: true })).toBe("unreachable");
    expect(loadState({ ...facts, registered: false, failed: true })).toBe("not-installed");
  });

  it("makes a page as unreachable as the worst list it stands on", () => {
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf("connecting", "unreachable")).toBe("unreachable");
    expect(worstOf()).toBe("ready");
    expect(inventoryState("ready", "unreachable")).toBe("unreachable");
    expect(inventoryState("not-installed", "connecting")).toBe("not-installed");
    expect(inventoryState("ready", "ready")).toBe("ready");
  });

  it("alarms over pods only where a cluster lives, or when refused everywhere", () => {
    const where = [...new Set(replicaSets().map((each) => each.getNs() ?? ""))];

    expect(failedAmong(new Set(["kube-system"]), where)).toBe(false);
    expect(failedAmong(new Set(where), where)).toBe(true);
    expect(failedAmong(new Set([EVERYWHERE]), where)).toBe(true);
    expect(failedAmong(new Set(), where)).toBe(false);
  });
});

describe("a cluster whose namespace refused its pods", () => {
  const rows = (failed: string[]) =>
    replicaSetRows({
      ...inventory(),
      // The host keeps no pod of a namespace that refused them.
      pods: pods().filter((each) => !failed.includes(each.getNs() ?? "")),
      podsFailed: new Set(failed),
    });
  const rs = named(replicaSets(), "catalog-rs");

  it("is not judged Down: its members are unknown, and say why", () => {
    for (const failed of [[rs.getNs() ?? ""], [EVERYWHERE]]) {
      const row = rows(failed).find((each) => each.rs.getName() === "catalog-rs");

      expect(row?.health).toEqual({
        tone: "info",
        label: "Members unknown",
        reason: "Its pods could not be read, so its members cannot be judged.",
      });
      expect(row?.members.map((each) => each.problem)).not.toContain("It has no pod yet.");
    }
  });

  it("leaves the clusters of the namespaces that answered judged", () => {
    expect(
      rows(["elsewhere"]).find((each) => each.rs.getName() === "catalog-rs")?.health.tone,
    ).toBe("ok");
    expect(podsReadIn("read", new Set(["elsewhere"]), "mongodb")).toBe("read");
    expect(podsReadIn("read", new Set(["mongodb"]), "mongodb")).toBe("refused");
    expect(podsReadIn("reading", undefined, "mongodb")).toBe("reading");
  });
});

describe("before the clusters are read", () => {
  it("says why a list is empty instead of saying there is nothing", () => {
    expect(emptyText("connecting", "No MongoDB clusters in the namespaces in scope.")).toBe(
      "Connecting to the cluster…",
    );
    expect(emptyText("unreachable", "Nothing.")).toBe(
      "Nothing could be read, so nothing is listed.",
    );
    expect(emptyText("ready", "Nothing.")).toBe("Nothing.");
  });

  it("headlines no count of clusters it has not read", () => {
    expect(describeHeadline(0, 0, "connecting")).toBe("MongoDB clusters");
    expect(describeHeadline(0, 0, "unreachable")).toBe("MongoDB clusters");
    expect(describeHeadline(0, 0, "ready")).toBe("No MongoDB clusters");
  });
});

describe("polling the agents", () => {
  const keys = agentKeys(pods());
  const view = agentViewOf(healthOf("catalog-rs-0"), "catalog-rs-0");

  it("reads at most a few at once, and none already under way or still fresh", () => {
    expect(keys.length).toBeGreaterThan(MAX_READS);

    const [first = "", second = "", third = ""] = [...keys].sort();
    const reads = new Map([
      [first, startAgentRead(undefined)],
      [second, afterAgentRead(undefined, 1000, { view })],
      [third, afterAgentRead(undefined, 1000 - FRESH_MS, { view })],
    ]);
    const due = dueReads([...keys, first], reads, 1000, 0);

    expect(due).toHaveLength(MAX_READS);
    expect(due).not.toContain(first);
    expect(due).not.toContain(second);
    expect(due).toContain(third);
    expect(dueReads(keys, new Map(), 0, MAX_READS - 2)).toHaveLength(2);
    expect(dueReads(keys, new Map(), 0, MAX_READS + 1)).toEqual([]);
  });

  it("keeps the last view while a read is under way, and ends it with the answer", () => {
    const read = afterAgentRead(undefined, 1, { view });
    const again = startAgentRead(read);

    expect(again).toEqual({ at: 1, view, inFlight: true });
    expect(afterAgentRead(again, 2, { view })).toEqual({ at: 2, view });
    expect(agentsError([startAgentRead(undefined)])).toBeUndefined();
    expect(agentsError([startAgentRead(afterAgentRead(undefined, 1, { failed: "refused" }))])).toBe(
      "refused",
    );
  });
});

const hung = () => new Promise<never>(() => {});

describe("a read with a timeout", () => {
  it("gives up on a read that never answers, and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = withTimeout((given) => {
      signal = given;

      return hung();
    });
    const outcome = expect(read).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });

  it("keeps an answer that comes in time, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const listed = events();

    await expect(withTimeout(async () => listed)).resolves.toBe(listed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a refused read sooner, doubling up to a minute, and re-lists slowly once it answers", () => {
    expect(nextReadDelay(0)).toBe(RELIST_MS);
    expect(nextReadDelay(1)).toBe(2_000);
    expect(nextReadDelay(3)).toBe(8_000);
    expect(nextReadDelay(20)).toBe(60_000);
  });
});

describe("a drawer's warning events, read for its namespace", () => {
  const rs = named(replicaSets(), "legacy-rs");
  const listed: WarningsRead = { events: events() };

  it("keeps what was read through a failed re-list, and takes the next answer", () => {
    const failed: WarningsRead = { error: "403 Forbidden" };

    expect(nextWarnings(listed, failed)).toBe(listed);
    expect(nextWarnings(undefined, failed)).toBe(failed);
    expect(nextWarnings(failed, listed)).toBe(listed);
  });

  it("says it is reading, why it could not, or that there are none, before listing any", () => {
    expect(warningsNote(undefined, 0)).toBe("Reading its namespace's warning events…");
    expect(warningsNote({ error: "403 Forbidden" }, 0)).toBe(
      "Could not read its namespace's events (403 Forbidden).",
    );
    expect(warningsNote({ events: [] }, 0)).toBe(
      "No warning events for the cluster, its pods or its volumes.",
    );
    expect(warningsNote(listed, replicaSetEvents(events(), rs).length)).toBeUndefined();
  });

  it("keeps only the events of its own namespace, from the plain list the API returns", () => {
    const moved = events().map((each) => ({
      ...each,
      metadata: { ...each.metadata, namespace: "elsewhere" },
    }));

    expect(replicaSetEvents(events(), rs).length).toBeGreaterThan(0);
    expect(replicaSetEvents(moved, rs)).toEqual([]);
  });
});
