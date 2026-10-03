import { describe, expect, it } from "vitest";

import { clusterIdFromHost, stateFileName } from "../src/renderer/api/cluster-scope";

// Expectations match the host's `getClusterIdFromHost`, including the cases that look like bugs.

const CLUSTER_ID = "289e8b234825329f053f98f8d145e660";

describe("the cluster a frame is showing", () => {
  it("reads the id out of a cluster frame host", () => {
    expect(clusterIdFromHost(`${CLUSTER_ID}.renderer.freelens.app:35397`)).toBe(CLUSTER_ID);
  });

  it("reads it out of the localhost form the host also serves", () => {
    expect(clusterIdFromHost(`${CLUSTER_ID}.localhost:45345`)).toBe(CLUSTER_ID);
  });

  it("names a file after the cluster", () => {
    expect(stateFileName(CLUSTER_ID)).toBe(`${CLUSTER_ID}.json`);
  });

  it("gives two clusters two different files", () => {
    expect(stateFileName(CLUSTER_ID)).not.toBe(stateFileName("0".repeat(32)));
  });
});

describe("hosts that name no cluster", () => {
  it("finds none in the root frame", () => {
    expect(clusterIdFromHost("renderer.freelens.app:35397")).toBeUndefined();
    expect(stateFileName(clusterIdFromHost("renderer.freelens.app:35397"))).toBeUndefined();
  });

  it("finds none on bare localhost, with or without a port", () => {
    expect(clusterIdFromHost("localhost:3000")).toBeUndefined();
    expect(clusterIdFromHost("localhost")).toBeUndefined();
  });

  it("takes the trailing label of a two-label host, which is not a cluster id", () => {
    expect(clusterIdFromHost("example.com:1")).toBe("com");
  });

  it("returns an empty string for an empty host, and refuses to name a file for it", () => {
    expect(clusterIdFromHost("")).toBe("");
    expect(stateFileName("")).toBeUndefined();
  });
});

describe("hosts that only look like a cluster frame", () => {
  it("yields a trailing label, not a cluster id, when the suffix merely appears", () => {
    expect(clusterIdFromHost("renderer.freelens.app.evil.example:443")).toBe("example");
    expect(clusterIdFromHost("evil-renderer.freelens.app:1")).toBe("app");
  });

  it("strips exactly three labels, as the host does", () => {
    expect(clusterIdFromHost("a.b.c.renderer.freelens.app:1")).toBe("c");
  });

  it("survives dots and extra colons without inventing a partial id", () => {
    expect(clusterIdFromHost(".")).toBe("");
    expect(clusterIdFromHost("..")).toBe("");
    expect(clusterIdFromHost("...renderer.freelens.app:1")).toBe("");
    expect(clusterIdFromHost("host:1:2")).toBe("host");
  });

  it("refuses anything that would not be one path segment", () => {
    expect(stateFileName("../../../etc/passwd")).toBeUndefined();
    expect(stateFileName("a/b")).toBeUndefined();
    expect(stateFileName("a.b")).toBeUndefined();
    expect(stateFileName(undefined)).toBeUndefined();
  });

  it("accepts an id at the length limit and refuses one past it", () => {
    expect(stateFileName("a".repeat(64))).toBe(`${"a".repeat(64)}.json`);
    expect(stateFileName("a".repeat(65))).toBeUndefined();
  });
});
