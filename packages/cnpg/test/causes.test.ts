import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  causeFromLog,
  logSourceFor,
  PLUGIN_CONTAINER,
  wantsCause,
} from "../src/renderer/api/causes";
import { clusterNamed, variantOf } from "./fixtures";

const pluginLog = readFileSync(resolve(__dirname, "fixtures/plugin-log.txt"), "utf8");

describe("the cause of a failed backup", () => {
  it("is barman's own error, not the operator's exit status", () => {
    const cause = causeFromLog(pluginLog);

    expect(cause).toMatch(
      /^Barman cloud WAL archive check exception: Permission denied when accessing bucket/,
    );
    expect(cause).not.toContain("exit status");
  });

  it("is the latest one when barman has said several things", () => {
    const lines = pluginLog.trim().split("\n");
    const last = lines.filter((line) => line.includes("ERROR:")).at(-1);
    const later = JSON.stringify({ msg: "2026-10-03 23:00:00,000 [1] ERROR: Something newer" });

    expect(last).toBeDefined();
    expect(causeFromLog([...lines, later].join("\n"))).toBe("Something newer");
  });

  it("finds none in a log without barman errors, or one that is not JSON", () => {
    const quiet = pluginLog
      .split("\n")
      .filter((line) => !line.includes("ERROR:"))
      .join("\n");

    expect(causeFromLog(quiet)).toBeUndefined();
    expect(causeFromLog("plain text\n{not json")).toBeUndefined();
    expect(causeFromLog(JSON.stringify({ msg: 42 }))).toBeUndefined();
  });
});

describe("where to read it", () => {
  it("is the primary's plugin sidecar for the plugin", () => {
    expect(logSourceFor(clusterNamed("billing-db"))).toEqual({
      pod: "billing-db-1",
      container: PLUGIN_CONTAINER,
    });
  });

  it("is postgres itself for the in-tree object store", () => {
    const inTree = variantOf(clusterNamed("inventory-db"), (raw) => {
      raw.spec.backup = { barmanObjectStore: { destinationPath: "s3://x/" } };
    });

    expect(logSourceFor(inTree)).toEqual({ pod: "inventory-db-1", container: "postgres" });
  });

  it("is nowhere without archiving, or without a primary", () => {
    expect(logSourceFor(clusterNamed("inventory-db"))).toBeUndefined();
    expect(logSourceFor(clusterNamed("analytics-db"))).toBeUndefined();
  });
});

describe("when to look in the log", () => {
  it("only for failures whose reason the operator leaves out", () => {
    expect(wantsCause("Archiving failing")).toBe(true);
    expect(wantsCause("Last backup failed")).toBe(true);
    expect(wantsCause("Last run failed")).toBe(true);
    expect(wantsCause("No backup")).toBe(false);
    expect(wantsCause("Backed up")).toBe(false);
  });
});
