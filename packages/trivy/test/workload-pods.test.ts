import { describe, expect, it } from "vitest";
import type { ReportSubject } from "../src/renderer/api/types";
import {
  describePod,
  interestingLabels,
  type PodLike,
  podPath,
  selectPodsOf,
  sortPods,
} from "../src/renderer/api/workload-pods";
import { pods } from "./fixtures";

const pod = (
  over: Partial<PodLike> & { name: string; owners?: { kind: string; name: string }[] },
) =>
  ({
    getName: () => over.name,
    getNs: () => over.getNs?.() ?? "argocd",
    getOwnerRefs: () => over.owners ?? [],
    getLabels: () => over.getLabels?.() ?? [],
    getNodeName: () => over.getNodeName?.(),
    selfLink: over.selfLink,
    status: over.status,
  }) satisfies PodLike;

function aRealOwner(): ReportSubject | undefined {
  for (const each of pods()) {
    const owner = each.getOwnerRefs().find((ref) => ref.kind === "ReplicaSet" && ref.name);

    if (owner?.name) {
      return { namespace: each.getNs() ?? "", kind: "ReplicaSet", name: owner.name };
    }
  }

  return undefined;
}

describe("finding the pods a report's subject runs", () => {
  it("finds them in the cluster's own pods", () => {
    const subject = aRealOwner();

    expect(subject).toBeDefined();

    const found = selectPodsOf(pods(), subject as ReportSubject);

    expect(found.length).toBeGreaterThan(0);
    for (const each of found) expect(each.getNs()).toBe((subject as ReportSubject).namespace);
  });

  it("carries the namespace, the phase and the link the host opens", () => {
    const found = selectPodsOf(pods(), aRealOwner() as ReportSubject).map(describePod);

    expect(found[0]?.namespace).not.toBe("");
    expect(found[0]?.phase).not.toBe("");
    expect(found[0]?.selfLink).toContain("/pods/");
  });

  it("matches on ownerReferences, not on a shared name prefix", () => {
    const subject: ReportSubject = { namespace: "argocd", kind: "ReplicaSet", name: "server" };
    const mine = pod({ name: "server-abc", owners: [{ kind: "ReplicaSet", name: "server" }] });
    const lookalike = pod({
      name: "server-metrics-abc",
      owners: [{ kind: "ReplicaSet", name: "server-metrics" }],
    });

    expect(selectPodsOf([mine, lookalike], subject).map((each) => each.getName())).toEqual([
      "server-abc",
    ]);
  });

  it("does not cross namespaces for a controller of the same name", () => {
    const subject: ReportSubject = { namespace: "argocd", kind: "ReplicaSet", name: "web" };
    const here = pod({ name: "here", owners: [{ kind: "ReplicaSet", name: "web" }] });
    const there = {
      ...pod({ name: "there", owners: [{ kind: "ReplicaSet", name: "web" }] }),
      getNs: () => "podinfo",
    };

    expect(selectPodsOf([here, there], subject).map((each) => each.getName())).toEqual(["here"]);
  });

  it("builds the API path itself when the cluster sent no selfLink", () => {
    const bare = { ...pod({ name: "web-1" }), selfLink: undefined };

    expect(describePod(bare).selfLink).toBe("/api/v1/namespaces/argocd/pods/web-1");
  });

  it("keeps the selfLink the host derived when there is one", () => {
    const linked = { ...pod({ name: "web-1" }), selfLink: "/api/v1/namespaces/x/pods/y" };

    expect(describePod(linked).selfLink).toBe("/api/v1/namespaces/x/pods/y");
  });

  it("does not match a controller of a different kind with the same name", () => {
    const subject: ReportSubject = { namespace: "argocd", kind: "StatefulSet", name: "web" };
    const owned = pod({ name: "web-0", owners: [{ kind: "ReplicaSet", name: "web" }] });

    expect(selectPodsOf([owned], subject)).toEqual([]);
  });
});

describe("finding pods when there are none to find", () => {
  const subject: ReportSubject = { namespace: "argocd", kind: "ReplicaSet", name: "web" };

  it("returns nothing for a controller whose pods are gone", () => {
    expect(selectPodsOf([], subject)).toEqual([]);
    expect(sortPods([])).toEqual([]);
  });

  it("returns nothing for a pod that names no owner at all", () => {
    expect(selectPodsOf([pod({ name: "orphan" })], subject)).toEqual([]);
  });

  it("calls a pod with no status Unknown rather than assuming it runs", () => {
    expect(describePod(pod({ name: "web-1" })).phase).toBe("Unknown");
  });

  it("reports an empty namespace rather than undefined", () => {
    const nameless = { ...pod({ name: "web-1" }), getNs: () => undefined };

    expect(describePod(nameless).namespace).toBe("");
  });
});

describe("ordering and trimming what is shown", () => {
  const at = (name: string, phase: string) => ({
    name,
    namespace: "argocd",
    phase,
    labels: [],
    selfLink: podPath("argocd", name),
  });
  const running = at("b", "Running");
  const pending = at("a", "Pending");
  const done = at("c", "Succeeded");

  it("puts running pods first and finished ones last", () => {
    expect(sortPods([done, pending, running]).map((each) => each.phase)).toEqual([
      "Running",
      "Pending",
      "Succeeded",
    ]);
  });

  it("breaks a tie by name so the order does not wander", () => {
    const first = { ...running, name: "alpha" };
    const second = { ...running, name: "beta" };

    expect(sortPods([second, first]).map((each) => each.name)).toEqual(["alpha", "beta"]);
  });

  it("drops the hashes Kubernetes stamps on and keeps what names the workload", () => {
    const kept = interestingLabels([
      "app.kubernetes.io/name=argocd-server",
      "pod-template-hash=7c6d8d444b",
      "controller-revision-hash=abc",
    ]);

    expect(kept).toEqual(["app.kubernetes.io/name=argocd-server"]);
  });

  it("keeps a label whose value merely contains a noisy name", () => {
    expect(interestingLabels(["app=pod-template-hash"])).toEqual(["app=pod-template-hash"]);
  });
});
