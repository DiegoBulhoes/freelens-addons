import { describe, expect, it } from "vitest";
import { subjectKey, subjectOf } from "../../src/renderer/api/shared/subjects";
import type { ReportSubject } from "../../src/renderer/api/shared/types";
import {
  bearsAnImage,
  COVERAGE_STATUS,
  type CoverageInput,
  coverageStateOf,
  getCoverage,
  isUnjudged,
  ownerDeploymentOf,
  runningOf,
  tallyCoverage,
  workloadGaps,
} from "../../src/renderer/api/workloads/coverage";
import {
  configAuditReports,
  pods,
  replicaSets,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

function keysOf(reports: { getLabels(): string[]; getOwnerRefs(): { name: string }[] }[]) {
  return new Set(
    reports
      .map(subjectOf)
      .filter((subject) => subject !== undefined)
      .map(subjectKey),
  );
}

function clusterCoverage(): CoverageInput {
  const known = [...configAuditReports(), ...sbomReports(), ...vulnerabilityReports()]
    .map(subjectOf)
    .filter((subject) => subject !== undefined);

  return { known, withSbom: keysOf(sbomReports()), withVerdict: keysOf(vulnerabilityReports()) };
}

const workload = (name: string): ReportSubject => ({
  namespace: "argocd",
  kind: "ReplicaSet",
  name,
});

describe("deciding what the scanner actually covered", () => {
  it("finds workloads whose image was read but never judged", () => {
    const counts = tallyCoverage(getCoverage(clusterCoverage()));

    // Fixtures were taken while scans were failing.
    expect(counts.readButNoVerdict).toBeGreaterThan(0);
    expect(counts.scanned).toBeLessThan(counts.total);
  });

  it("counts every workload exactly once across the states", () => {
    const counts = tallyCoverage(getCoverage({ ...clusterCoverage(), running: runningOf(pods()) }));

    expect(counts.inactive).toBeGreaterThan(0);
    expect(counts.scanned + counts.readButNoVerdict + counts.neverLooked + counts.inactive).toBe(
      counts.total,
    );
  });

  it("calls a workload scanned only when a verdict exists, not merely an SBOM", () => {
    const input: CoverageInput = {
      known: [workload("judged"), workload("read-only")],
      withSbom: new Set([subjectKey(workload("judged")), subjectKey(workload("read-only"))]),
      withVerdict: new Set([subjectKey(workload("judged"))]),
    };

    expect(coverageStateOf(workload("judged"), input)).toBe("scanned");
    expect(coverageStateOf(workload("read-only"), input)).toBe("read-but-no-verdict");
  });

  it("deduplicates a subject named by several report kinds", () => {
    const input: CoverageInput = {
      known: [workload("web"), workload("web"), workload("web")],
      withSbom: new Set(),
      withVerdict: new Set(),
    };

    expect(getCoverage(input)).toHaveLength(1);
  });

  it("leaves out kinds that carry no image, which cannot be scanned for one", () => {
    const input: CoverageInput = {
      known: [
        workload("web"),
        { namespace: "argocd", kind: "Service", name: "web" },
        { namespace: "argocd", kind: "NetworkPolicy", name: "default-deny" },
      ],
      withSbom: new Set(),
      withVerdict: new Set(),
    };

    expect(getCoverage(input).map((entry) => entry.subject.kind)).toEqual(["ReplicaSet"]);
  });
});

describe("deciding coverage when there is nothing to decide from", () => {
  const empty: CoverageInput = { known: [], withSbom: new Set(), withVerdict: new Set() };

  it("reports nothing rather than claiming a clean cluster", () => {
    expect(tallyCoverage(getCoverage(empty))).toEqual({
      scanned: 0,
      readButNoVerdict: 0,
      neverLooked: 0,
      inactive: 0,
      total: 0,
    });
  });

  it("calls a workload never-looked-at when neither an SBOM nor a verdict exists", () => {
    expect(coverageStateOf(workload("web"), empty)).toBe("never-looked");
  });
});

describe("deciding a coverage state", () => {
  it("treats a verdict without an SBOM as scanned, the verdict being the stronger claim", () => {
    const input: CoverageInput = {
      known: [workload("web")],
      withSbom: new Set(),
      withVerdict: new Set([subjectKey(workload("web"))]),
    };

    expect(coverageStateOf(workload("web"), input)).toBe("scanned");
  });

  it("distinguishes two workloads whose names match across namespaces", () => {
    const here: ReportSubject = { namespace: "a", kind: "ReplicaSet", name: "web" };
    const there: ReportSubject = { namespace: "b", kind: "ReplicaSet", name: "web" };
    const input: CoverageInput = {
      known: [here, there],
      withSbom: new Set(),
      withVerdict: new Set([subjectKey(here)]),
    };

    expect(coverageStateOf(here, input)).toBe("scanned");
    expect(coverageStateOf(there, input)).toBe("never-looked");
    expect(getCoverage(input)).toHaveLength(2);
  });

  it("does not treat a Pod as imageless just because it is not a controller", () => {
    expect(bearsAnImage({ namespace: "a", kind: "Pod", name: "one-off" })).toBe(true);
    expect(bearsAnImage({ namespace: "a", kind: "ConfigMap", name: "settings" })).toBe(false);
  });
});

describe("showing a coverage state", () => {
  it("gives each state a word and a tone, worst in the critical tone", () => {
    expect(COVERAGE_STATUS.scanned).toEqual({ label: "Scanned", tone: "ok" });
    expect(COVERAGE_STATUS["read-but-no-verdict"]).toEqual({
      label: "No verdict",
      tone: "warning",
    });
    expect(COVERAGE_STATUS["never-looked"]).toEqual({ label: "Not looked at", tone: "critical" });
  });

  it("writes every state in sentence case, as the drawer's banner and the host do", () => {
    for (const { label } of Object.values(COVERAGE_STATUS)) {
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
      expect(label.slice(1)).toBe(label.slice(1).toLowerCase());
    }
  });
});

describe("telling a scaled-away ReplicaSet from a gap in the scan", () => {
  // The fixtures' rollout left web's old ReplicaSet with an SBOM, no verdict and no pod.
  const old: ReportSubject = { namespace: "demo", kind: "ReplicaSet", name: "web-794cc4c7f4" };
  const current: ReportSubject = { namespace: "demo", kind: "ReplicaSet", name: "web-5774f6f6c7" };

  it("calls an unjudged ReplicaSet no pod belongs to inactive, not unjudged", () => {
    const input = { ...clusterCoverage(), running: runningOf(pods()) };

    expect(coverageStateOf(old, input)).toBe("inactive");
    expect(coverageStateOf(current, input)).toBe("scanned");
    expect(isUnjudged(coverageStateOf(old, input))).toBe(false);
  });

  it("judges nothing inactive without the pods, or where they could not be read", () => {
    const unread = { ...clusterCoverage(), running: runningOf(pods(), new Set(["demo"])) };

    expect(coverageStateOf(old, clusterCoverage())).toBe("read-but-no-verdict");
    expect(coverageStateOf(old, unread)).toBe("read-but-no-verdict");
  });

  it("keeps an unjudged ReplicaSet with a pod unjudged", () => {
    const entries = getCoverage({ ...clusterCoverage(), running: runningOf(pods()) });
    const unscannable = entries.filter((entry) => entry.subject.name.startsWith("unscannable-"));

    expect(unscannable.map((entry) => entry.state)).toEqual(["never-looked"]);
  });

  it("only ever judges a ReplicaSet inactive", () => {
    // No verdict and no pod anywhere: every kind is a candidate.
    const entries = getCoverage({
      ...clusterCoverage(),
      withVerdict: new Set(),
      running: runningOf([]),
    });
    const others = entries.filter((entry) => entry.subject.kind !== "ReplicaSet");

    expect(others.length).toBeGreaterThan(0);
    for (const entry of others) expect(entry.state).not.toBe("inactive");
    for (const entry of entries.filter((each) => each.subject.kind === "ReplicaSet")) {
      expect(entry.state).toBe("inactive");
    }
  });

  // The same old ReplicaSet, asked again for a pod it never got: by quota or admission.
  const wanting = () =>
    replicaSets().map((each) =>
      each.getName() === old.name && each.getNs() === old.namespace
        ? { ...each, spec: { replicas: 1 } }
        : each,
    );

  it("keeps a ReplicaSet that wants a pod and has none unjudged, not scaled away", () => {
    const input = { ...clusterCoverage(), running: runningOf(pods(), new Set(), wanting()) };

    expect(coverageStateOf(old, input)).toBe("read-but-no-verdict");
    expect(coverageStateOf(current, input)).toBe("scanned");
  });

  it("calls a ReplicaSet at zero replicas, or gone, inactive", () => {
    const atZero = runningOf(pods(), new Set(), replicaSets());
    const gone = runningOf(
      pods(),
      new Set(),
      replicaSets().filter((each) => each.getName() !== old.name),
    );

    expect(coverageStateOf(old, { ...clusterCoverage(), running: atZero })).toBe("inactive");
    expect(coverageStateOf(old, { ...clusterCoverage(), running: gone })).toBe("inactive");
  });

  it("falls back to the pods where the ReplicaSets could not be read", () => {
    const running = runningOf(pods(), new Set(), wanting(), new Set(["demo"]));

    expect(coverageStateOf(old, { ...clusterCoverage(), running })).toBe("inactive");
  });

  it("keeps a stalled rollout's old ReplicaSet, still serving, unjudged", () => {
    // The seed stalls stalled's rollout: the operator drops the old one's verdict, keeps its SBOM.
    const stalled: ReportSubject = {
      namespace: "demo",
      kind: "ReplicaSet",
      name: "stalled-847ddffb97",
    };
    const running = runningOf(pods(), new Set(), replicaSets());

    expect(coverageStateOf(stalled, { ...clusterCoverage(), running })).toBe("read-but-no-verdict");
  });

  it("labels a scaled-away ReplicaSet as such", () => {
    expect(COVERAGE_STATUS.inactive).toEqual({ label: "Scaled away", tone: "info" });
  });
});

describe("warning of the workload lists that could not be read", () => {
  const refused = (kinds: Record<string, string[]>) =>
    new Map(Object.entries(kinds).map(([kind, namespaces]) => [kind, new Set(namespaces)]));

  it("says nothing of the pods where the ReplicaSets were read, since those decide", () => {
    expect(workloadGaps(refused({ Pod: ["demo"] }))).toEqual([]);
  });

  it("says a ReplicaSet is not taken for scaled away where neither list was read", () => {
    expect(workloadGaps(refused({ Pod: ["demo"], ReplicaSet: ["demo"] }))).toEqual([
      "Could not read Pods in demo. A ReplicaSet there is not taken for scaled away.",
    ]);
  });

  it("says a ReplicaSet is judged by its pods where only the ReplicaSets were refused", () => {
    expect(workloadGaps(refused({ ReplicaSet: ["demo"] }))).toEqual([
      "Could not read ReplicaSets in demo. A ReplicaSet there is judged by its pods.",
    ]);
  });
});

describe("naming the Deployment a ReplicaSet belongs to", () => {
  it("strips the pod-template-hash the Deployment controller appends, as every pod shows", () => {
    const owned = pods().flatMap((pod) => {
      const hash = pod
        .getLabels()
        .find((label) => label.startsWith("pod-template-hash="))
        ?.slice("pod-template-hash=".length);
      const owner = pod.getOwnerRefs().find((each) => each.kind === "ReplicaSet");

      return hash && owner?.name ? [{ name: owner.name, hash, namespace: pod.getNs() ?? "" }] : [];
    });

    expect(owned.length).toBeGreaterThan(5);
    for (const { name, hash, namespace } of owned) {
      expect(ownerDeploymentOf({ namespace, kind: "ReplicaSet", name })).toBe(
        name.slice(0, -(hash.length + 1)),
      );
    }
  });

  it("takes the Deployment from each ReplicaSet's ownerReferences once they are read", () => {
    const running = runningOf(pods(), new Set(), replicaSets());
    const owned = replicaSets().filter((each) =>
      each.getOwnerRefs().some((owner) => owner.kind === "Deployment"),
    );

    expect(owned.length).toBeGreaterThan(5);
    for (const each of owned) {
      const subject = { namespace: each.getNs() ?? "", kind: "ReplicaSet", name: each.getName() };

      expect(ownerDeploymentOf(subject, running)).toBe(
        each.getOwnerRefs().find((owner) => owner.kind === "Deployment")?.name,
      );
    }
  });

  it("names no Deployment for a ReplicaSet another controller owns, though its name has a hash", () => {
    const web = { namespace: "demo", kind: "ReplicaSet", name: "web-5774f6f6c7" };
    const rollout = replicaSets().map((each) =>
      each.getName() === web.name
        ? { ...each, getOwnerRefs: () => [{ kind: "Rollout", name: "web" }] }
        : each,
    );

    expect(ownerDeploymentOf(web)).toBe("web");
    expect(ownerDeploymentOf(web, runningOf(pods(), new Set(), rollout))).toBeUndefined();
  });

  it("names the Deployment of a ReplicaSet that is gone", () => {
    const gone: ReportSubject = { namespace: "demo", kind: "ReplicaSet", name: "web-794cc4c7f4" };

    expect(ownerDeploymentOf(gone)).toBe("web");
  });

  it("names none for a ReplicaSet no Deployment made, nor for another kind", () => {
    const backend: ReportSubject = { namespace: "sync-waves", kind: "ReplicaSet", name: "backend" };
    const controller: ReportSubject = {
      namespace: "argocd",
      kind: "StatefulSet",
      name: "argocd-application-controller",
    };

    expect(ownerDeploymentOf(backend)).toBeUndefined();
    expect(ownerDeploymentOf(controller)).toBeUndefined();
  });

  it("takes no hand-picked name for a hash, as none of the cluster's other workloads' names is", () => {
    const named = configAuditReports()
      .map(subjectOf)
      .filter(
        (subject): subject is ReportSubject =>
          subject !== undefined && subject.kind !== "ReplicaSet",
      )
      .map((subject) => ({ ...subject, kind: "ReplicaSet" }));

    expect(named.filter((subject) => subject.name.includes("-")).length).toBeGreaterThan(5);
    for (const subject of named) expect(ownerDeploymentOf(subject)).toBeUndefined();
  });
});
