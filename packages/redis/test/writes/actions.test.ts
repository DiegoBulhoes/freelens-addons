import { afterEach, describe, expect, it, vi } from "vitest";
import { nodesOf } from "../../src/renderer/api/objects/nodes";
import {
  eventsOf,
  type PartialObjectMetadataList,
  settledListings,
  tlsNamespaces,
} from "../../src/renderer/api/objects/upkeep";
import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";
import { nextReadDelay, RELIST_MS } from "../../src/renderer/api/shared/retry";
import {
  freshPlan,
  listSecretNames,
  listWarningEvents,
  until,
} from "../../src/renderer/api/writes/actions";
import eventsJson from "../fixtures/events.json";
import secretNamesJson from "../fixtures/secret-names.json";
import { events, named, objects, pods, pvcs, secrets } from "../support/fixtures";

const hung = () => new Promise<never>(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

    await expect(withTimeout(async () => secretNamesJson)).resolves.toEqual(secretNamesJson);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("listing Secret names", () => {
  it("reads only the namespaces of objects with TLS", () => {
    expect(tlsNamespaces(objects())).toEqual([named("sessions").getNs()]);
    expect(tlsNamespaces(objects().filter((each) => each.getName() !== "sessions"))).toEqual([]);
  });

  it("keeps each namespace's own outcome, the names or why it was refused", () => {
    expect(
      settledListings(
        ["refused", "redis", "unasked"],
        [
          { status: "rejected", reason: new Error("403 Forbidden") },
          { status: "fulfilled", value: secretNamesJson as PartialObjectMetadataList },
        ],
      ),
    ).toEqual(
      new Map<string, unknown>([
        ["refused", { error: "403 Forbidden" }],
        ["redis", secrets()],
        ["unasked", { error: "not listed" }],
      ]),
    );
    expect(
      settledListings(["redis"], [{ status: "rejected", reason: "gone" }]).get("redis"),
    ).toEqual({ error: "gone" });
  });

  it("a namespace that refuses or never answers hides no other's", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (url: string) => {
      if (url.includes("/namespaces/redis/")) {
        return Promise.resolve(new Response(JSON.stringify(secretNamesJson)));
      }

      return url.includes("/namespaces/silent/")
        ? hung()
        : Promise.resolve(new Response("", { status: 403, statusText: "Forbidden" }));
    });
    const listed = listSecretNames(["refused", "silent", "redis"]);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);

    expect(await listed).toEqual(
      new Map<string, unknown>([
        ["refused", { error: "403 Forbidden" }],
        ["silent", { error: "No answer in 20s" }],
        ["redis", secrets()],
      ]),
    );
  });

  it("re-lists soon after a refusal, backing off, and slowly once every namespace answers", () => {
    expect(nextReadDelay(0)).toBe(RELIST_MS);
    expect([1, 2, 3, 10].map(nextReadDelay)).toEqual([2_000, 4_000, 8_000, 60_000]);
  });
});

describe("reading a drawer's warning events", () => {
  it("asks the namespace for everything but Normal events, and keeps them as listed", async () => {
    let asked = "";

    vi.stubGlobal("fetch", (url: string) => {
      asked = url;

      return Promise.resolve(new Response(JSON.stringify(eventsJson)));
    });

    const listed = await listWarningEvents("redis");

    expect(asked).toBe("/api-kube/api/v1/namespaces/redis/events?fieldSelector=type!%3DNormal");
    expect(listed).toEqual(events());
    expect(eventsOf(listed, named("broken-cache")).length).toBeGreaterThan(0);
  });

  it("says why a namespace refused, and gives up on one that never answers", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("", { status: 403, statusText: "Forbidden" })),
    );
    await expect(listWarningEvents("redis")).rejects.toThrow("403 Forbidden");

    vi.useFakeTimers();
    vi.stubGlobal("fetch", hung);
    const silent = expect(listWarningEvents("redis")).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await silent;
  });
});

describe("waiting on a restart", () => {
  it("polls again after a check that never answers, instead of waiting on it", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const done = until("cache-1 coming back", () => {
      calls += 1;

      return calls === 1 ? hung() : Promise.resolve(true);
    });

    await vi.advanceTimersByTimeAsync(3_000 + READ_TIMEOUT_MS + 3_000);

    await expect(done).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("a ticked row's restart, when its turn comes", () => {
  const cache = named("cache");
  const now = () => nodesOf(cache, pods(), pvcs());

  it("plans from a read made then: replicas first, the master last", async () => {
    const steps = await freshPlan(cache, async (object) => ({ object, nodes: now() }));
    const master = now().find((each) => each.role === "master")?.name;

    expect(steps.map((step) => step.node)).toHaveLength(3);
    expect(steps.at(-1)).toEqual({ node: master, last: true });
  });

  it("refuses when a pod went down since it was ticked", async () => {
    const down = now().map((each, at) => (at === 0 ? { ...each, ready: false } : each));

    await expect(freshPlan(cache, async (object) => ({ object, nodes: down }))).rejects.toThrow(
      /is not ready; restarting the others could leave no copy/,
    );
  });
});
