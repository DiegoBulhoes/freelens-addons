import { describe, expect, it } from "vitest";

import {
  dueReads,
  endRead,
  FRESH_MS,
  MAX_READS,
  type PolledRead,
  startRead,
} from "../../src/renderer/api/shared/polling";
import type { InstanceStatus } from "../../src/renderer/api/shared/types";
import { clusters, fixtureNow, instanceStatus } from "../support/fixtures";

// Every exported instance, as the overview asks for them.
const keys = clusters().flatMap((cluster) =>
  (cluster.status?.instanceNames ?? []).map((name) => `${cluster.getNs()}/${name}`),
);
const now = fixtureNow();
type Reads = Map<string, PolledRead<InstanceStatus | undefined>>;

describe("polling every instance's status", () => {
  it("has more instances to read than it starts at once", () => {
    expect(keys.length).toBeGreaterThan(MAX_READS);
  });

  it("starts no more reads than the free slots", () => {
    expect(dueReads(keys, new Map(), now, 0)).toHaveLength(MAX_READS);
    expect(dueReads(keys, new Map(), now, MAX_READS - 2)).toHaveLength(2);
    expect(dueReads(keys, new Map(), now, MAX_READS + 1)).toEqual([]);
  });

  it("never sends a read again while it is under way, however long it hangs", () => {
    const [first] = keys as [string];
    const reads: Reads = new Map([[first, startRead(undefined)]]);

    expect(dueReads([first], reads, now + 10 * FRESH_MS, 0)).toEqual([]);
  });

  it("reads again once its last answer is stale, not before", () => {
    const [first] = keys as [string];
    const reads: Reads = new Map([[first, endRead({ value: undefined }, now)]]);

    expect(dueReads([first], reads, now + FRESH_MS - 1, 0)).toEqual([]);
    expect(dueReads([first], reads, now + FRESH_MS, 0)).toEqual([first]);
    expect(dueReads([first], new Map([[first, { inFlight: false }]]), now, 0)).toEqual([first]);
  });

  it("asks once for a key given twice", () => {
    const [first] = keys as [string];

    expect(dueReads([first, first], new Map(), now, 0)).toEqual([first]);
  });

  it("keeps the last status while reading again, and drops it when the read fails", () => {
    const pod = "orders-db-2";
    const status = instanceStatus(pod);
    const answered = endRead({ value: status }, now);
    const again = startRead(answered);

    expect(answered).toEqual({ value: status, at: now, inFlight: false });
    expect(again).toEqual({ value: status, at: now, inFlight: true });
    expect(endRead({ error: new Error("No answer in 20s") }, now + 1)).toEqual({
      value: undefined,
      at: now + 1,
      inFlight: false,
    });
  });
});
