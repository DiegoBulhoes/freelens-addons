import { describe, expect, it } from "vitest";

import { Application, shortenRevision } from "../src/renderer/api/application";
import { application, applications, statusOf, variantOf } from "./fixtures";

describe("Application — what the cluster normally reports", () => {
  it("reads a single-source Application's source", () => {
    const single = applications().find(
      (candidate) => candidate.spec.source !== undefined && candidate.spec.sources === undefined,
    );

    expect(single, "the fixtures should contain a single-source Application").toBeDefined();
    expect(Application.getSources(single as Application)).toHaveLength(1);
    expect(Application.isMultiSource(single as Application)).toBe(false);
  });

  it("reads a multi-source Application's sources, which spec.source alone would miss", () => {
    const multi = applications().find((candidate) => (candidate.spec.sources?.length ?? 0) > 1);

    expect(multi, "the fixtures should contain a multi-source Application").toBeDefined();
    expect(Application.getSources(multi as Application).length).toBeGreaterThan(1);
    expect(Application.isMultiSource(multi as Application)).toBe(true);
  });

  it("rolls managed resources up into totals that add up", () => {
    for (const candidate of applications()) {
      const { total, synced, outOfSync } = Application.getResourceRollup(candidate);

      expect(total).toBe(Application.getManagedResources(candidate).length);
      expect(synced + outOfSync).toBeLessThanOrEqual(total);
    }
  });

  it("names the destination as ArgoCD displays it", () => {
    const target = application("podinfo");

    expect(Application.getDestination(target)).toBe("in-cluster/podinfo");
  });

  it("reports the phase of the last sync operation", () => {
    const succeeded = applications().find(
      (candidate) => Application.getLastSyncPhase(candidate) === "Succeeded",
    );

    expect(succeeded, "the fixtures should contain a completed sync").toBeDefined();
    expect(Application.getLastSyncPhase(succeeded as Application)).toBe("Succeeded");
  });

  it("lists the images an Application is running when ArgoCD summarised them", () => {
    const withImages = applications().find(
      (candidate) => Application.getImages(candidate).length > 0,
    );

    expect(withImages, "the fixtures should contain an image summary").toBeDefined();
    expect(Application.getImages(withImages as Application)[0]).toMatch(/\S+/);
  });

  it("names a remote cluster by host, keeping in-cluster for the local one", () => {
    const remote = variantOf("podinfo", (data) => {
      data.spec.destination = { server: "https://k8s.example.test:6443", namespace: "edge" };
    });

    expect(Application.getDestination(remote)).toBe("k8s.example.test:6443/edge");
  });

  it("shortens a 40-character SHA and leaves anything else alone", () => {
    expect(shortenRevision("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
    expect(shortenRevision("v1.2.3")).toBe("v1.2.3");
    expect(shortenRevision("main")).toBe("main");
  });
});

describe("Application — when the controller has not filled the status in", () => {
  it("reports Unknown rather than throwing when status is absent", () => {
    const fresh = variantOf("podinfo", (data) => {
      delete data.status;
    });

    expect(Application.getSyncStatus(fresh)).toBe("Unknown");
    expect(Application.getHealthStatus(fresh)).toBe("Unknown");
    expect(Application.getRevision(fresh)).toBeUndefined();
    expect(Application.getManagedResources(fresh)).toEqual([]);
    expect(Application.getImages(fresh)).toEqual([]);
  });

  it("reports no revision when sync exists but carries none", () => {
    const noRevision = variantOf("podinfo", (data) => {
      statusOf(data).sync = { status: "Unknown" };
    });

    expect(Application.getRevision(noRevision)).toBeUndefined();
  });

  it("treats an Application with neither source nor sources as having none", () => {
    const sourceless = variantOf("podinfo", (data) => {
      const spec = data.spec;
      delete spec.source;
      delete spec.sources;
    });

    expect(Application.getSources(sourceless)).toEqual([]);
    expect(Application.isMultiSource(sourceless)).toBe(false);
  });

  it("falls back to a destination that names only a namespace", () => {
    const namespaceOnly = variantOf("podinfo", (data) => {
      data.spec.destination = {
        namespace: "podinfo",
      };
    });

    expect(Application.getDestination(namespaceOnly)).toBe("podinfo");
  });
});

describe("Application — shapes nobody expects", () => {
  it("joins the revisions of a multi-source Application instead of picking one", () => {
    const many = variantOf("podinfo", (data) => {
      statusOf(data).sync = {
        status: "Synced",
        revisions: ["0123456789abcdef0123456789abcdef01234567", "v9.9.9"],
      };
    });

    expect(Application.getRevision(many)).toBe("0123456, v9.9.9");
  });

  it("drops empty strings out of a revisions list rather than rendering commas", () => {
    const ragged = variantOf("podinfo", (data) => {
      statusOf(data).sync = {
        status: "Synced",
        revisions: ["", "main", ""],
      };
    });

    expect(Application.getRevision(ragged)).toBe("main");
  });

  it("does not mistake a 39-character string for a SHA", () => {
    expect(shortenRevision("0123456789abcdef0123456789abcdef0123456")).toBe(
      "0123456789abcdef0123456789abcdef0123456",
    );
  });

  it("leaves an empty destination readable", () => {
    const empty = variantOf("podinfo", (data) => {
      data.spec.destination = {};
    });

    expect(Application.getDestination(empty)).toBe("—");
  });

  it("refuses to build an object with no selfLink, as the running app would", () => {
    const source = application("podinfo").toPlainObject() as Record<string, never>;
    const data = JSON.parse(JSON.stringify(source)) as { metadata: Record<string, unknown> };

    delete data.metadata.selfLink;

    expect(() => new Application(data as never)).toThrow(/selfLink/);
  });
});
