import { describe, expect, it } from "vitest";

import {
  formatBytes,
  intervalSeconds,
  LAG_BYTES,
  lsnDistance,
  lsnToNumber,
  replicaLags,
  slotRows,
  worstLag,
} from "../src/renderer/api/replication";
import { instanceStatus } from "./fixtures";

const replicas = () => ({
  "orders-db-1": instanceStatus("orders-db-1"),
  "orders-db-3": instanceStatus("orders-db-3"),
});

describe("reading LSNs and intervals", () => {
  it("turns an LSN into bytes and measures the distance between two", () => {
    expect(lsnToNumber("0/A000000")).toBe(0xa000000);
    expect(lsnToNumber("1/0")).toBe(2 ** 32);
    expect(lsnDistance("0/B000000", "0/A000000")).toBe(0x1000000);
    expect(lsnDistance("0/A000000", "0/B000000")).toBe(0);
    expect(lsnToNumber("not an lsn")).toBeUndefined();
    expect(lsnDistance(undefined, "0/1")).toBeUndefined();
  });

  it("reads Postgres intervals, and nothing else", () => {
    expect(intervalSeconds("00:00:02.5")).toBe(2.5);
    expect(intervalSeconds("01:02:03")).toBe(3723);
    expect(intervalSeconds("2 days")).toBeUndefined();
    expect(intervalSeconds(undefined)).toBeUndefined();
  });

  it("prints sizes in the unit that reads well", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(LAG_BYTES)).toBe("16 MB");
    expect(formatBytes(3 * 1024 ** 4 * 2000)).toBe("6000 TB");
  });
});

describe("each replica's lag, as the primary sees it", () => {
  const lags = replicaLags(instanceStatus("orders-db-2"), replicas());

  it("lists every streaming replica", () => {
    expect(lags.map((lag) => lag.replica)).toEqual(["orders-db-1", "orders-db-3"]);
    expect(lags.every((lag) => lag.state === "streaming")).toBe(true);
  });

  it("flags the replica whose replay was paused, with how far behind it is", () => {
    const paused = lags.find((lag) => lag.replica === "orders-db-3");

    expect(paused?.paused).toBe(true);
    expect(paused?.verdict).toMatchObject({ tone: "warning", label: "Replay paused" });
    expect(paused?.bytes).toBeGreaterThan(0);
    expect(paused?.verdict.reason).toMatch(/behind/);
  });

  it("keeps a replica that replays everything in sync", () => {
    expect(lags.find((lag) => lag.replica === "orders-db-1")?.verdict.label).toBe("In sync");
  });

  it("calls a replica lagging past the threshold, and broken when not streaming", () => {
    const primary = instanceStatus("orders-db-2");
    const [first] = primary.replicationInfo ?? [];
    if (!first) throw new Error("orders-db-2 reports no replica");

    const far = {
      ...primary,
      replicationInfo: [{ ...first, replayLsn: "0/0", replayLag: "00:01:00" }],
    };
    const gone = { ...primary, replicationInfo: [{ ...first, state: "catchup" }] };

    expect(replicaLags(far, {})[0]?.verdict.label).toBe("Lagging");
    expect(replicaLags(gone, {})[0]?.verdict).toMatchObject({
      tone: "critical",
      label: "Not streaming",
    });
  });

  it("has nothing to say without the primary's status, or for a primary with no replica", () => {
    expect(replicaLags(undefined, {})).toEqual([]);
    expect(replicaLags(instanceStatus("inventory-db-1"), {})).toEqual([]);
  });

  it("picks the worst replica, the furthest behind among equals", () => {
    expect(worstLag(lags)?.replica).toBe("orders-db-3");
    expect(worstLag([])).toBeUndefined();
  });
});

describe("replication slots", () => {
  it("lists the primary's slots with the WAL each keeps", () => {
    const rows = slotRows(instanceStatus("orders-db-2"));

    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.slot.slotType))).toEqual(new Set(["physical", "logical"]));
    expect(rows.find((row) => row.slot.slotType === "logical")?.slot.database).toBe("app");
    // Physical slots advance with the replica's flush, not its replay, so a paused replay keeps none.
    expect(rows.every((row) => row.retainedBytes !== undefined)).toBe(true);
  });

  it("warns of a slot nobody uses, or one whose WAL is gone", () => {
    const primary = instanceStatus("orders-db-2");
    const [slot] = primary.replicationSlotsInfo ?? [];
    if (!slot) throw new Error("orders-db-2 reports no slot");

    expect(
      slotRows({ ...primary, replicationSlotsInfo: [{ ...slot, active: false }] })[0]?.tone,
    ).toBe("warning");
    expect(
      slotRows({ ...primary, replicationSlotsInfo: [{ ...slot, walStatus: "lost" }] })[0]?.tone,
    ).toBe("warning");
    expect(slotRows(undefined)).toEqual([]);
  });
});
