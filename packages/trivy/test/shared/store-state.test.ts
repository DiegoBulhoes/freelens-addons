import { describe, expect, it } from "vitest";

import {
  addFailure,
  afterPass,
  describeFailures,
  describeGap,
  EVERYWHERE,
  type Failures,
  failedEverywhere,
  failedNamespacesOf,
  type LoadFacts,
  loadedForScope,
  loadState,
  readableScope,
  scopeOfKind,
  settleFailures,
  unreadIn,
} from "../../src/renderer/api/shared/store-state";

const SCOPE = ["argocd", "demo"];
const VULNERABILITIES = { kind: "VulnerabilityReport", namespaced: true };
const CLUSTER_ROLES = { kind: "ClusterRbacAssessmentReport", namespaced: false };

// What the host passes to onLoadFailure: its own Error, with the API's refusal as the cause.
function refusal(message: string): Error {
  return new Error("Failed to load /apis/aquasecurity.github.io/v1alpha1/vulnerabilityreports", {
    cause: { toString: () => message },
  });
}

const FORBIDDEN_IN_DEMO =
  'vulnerabilityreports.aquasecurity.github.io is forbidden: User "dev" cannot list resource "vulnerabilityreports" in API group "aquasecurity.github.io" in the namespace "demo"';
const FORBIDDEN_CLUSTER_WIDE =
  'vulnerabilityreports.aquasecurity.github.io is forbidden: User "dev" cannot list resource "vulnerabilityreports" in API group "aquasecurity.github.io" at the cluster scope';

function failures(entries: [string, string[]][]): Failures {
  const built = new Map<string, Set<string>>();

  for (const [kind, namespaces] of entries) addFailure(built, kind, namespaces);

  return built;
}

const facts = (overrides: Partial<LoadFacts>): LoadFacts => ({
  loaded: true,
  gaveUp: false,
  failures: new Map(),
  required: [VULNERABILITIES],
  scope: SCOPE,
  ...overrides,
});

describe("finding where a list was refused", () => {
  it("takes the namespace the API names in its refusal", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_IN_DEMO), SCOPE)).toEqual(["demo"]);
  });

  it("counts a refusal with no namespace against every namespace", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_CLUSTER_WIDE), SCOPE)).toEqual(SCOPE);
    expect(failedNamespacesOf(new Error("No answer in 20s"), SCOPE)).toEqual(SCOPE);
    expect(failedNamespacesOf(undefined, SCOPE)).toEqual(SCOPE);
  });

  it("does not trust a namespace outside the scope", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_IN_DEMO), ["argocd"])).toEqual(["argocd"]);
  });

  it("survives a refusal whose cause leads back to itself", () => {
    const looped = new Error("looped") as Error & { cause?: unknown };

    looped.cause = looped;

    expect(failedNamespacesOf(looped, SCOPE)).toEqual(SCOPE);
  });

  it("reads a refusal given as plain text", () => {
    expect(failedNamespacesOf(FORBIDDEN_IN_DEMO, SCOPE)).toEqual(["demo"]);
  });

  it("gives a cluster-scoped kind the one list it has", () => {
    expect(scopeOfKind(CLUSTER_ROLES, SCOPE)).toEqual([EVERYWHERE]);
    expect(scopeOfKind(VULNERABILITIES, SCOPE)).toEqual(SCOPE);
  });
});

describe("keeping what failed across retries", () => {
  it("collects namespaces by kind, once each", () => {
    const failed = failures([
      ["VulnerabilityReport", ["demo"]],
      ["VulnerabilityReport", ["demo", "argocd"]],
    ]);

    expect([...(failed.get("VulnerabilityReport") ?? [])].sort()).toEqual(["argocd", "demo"]);
  });

  it("replaces the outcome of the kinds retried and keeps the others", () => {
    const before = failures([
      ["VulnerabilityReport", ["demo"]],
      ["Pod", ["demo"]],
    ]);
    const settled = settleFailures(before, ["VulnerabilityReport"], new Map());

    expect(settled.has("VulnerabilityReport")).toBe(false);
    expect(settled.get("Pod")).toEqual(new Set(["demo"]));
  });

  it("keeps a retried kind that failed again", () => {
    const after = failures([["Pod", ["argocd"]]]);

    expect(settleFailures(new Map(), ["Pod"], after).get("Pod")).toEqual(new Set(["argocd"]));
    expect(settleFailures(after, ["Pod"], failures([["Pod", []]])).has("Pod")).toBe(false);
  });
});

describe("deciding what a page may count", () => {
  it("leaves out the namespaces where a report kind could not be read", () => {
    const failed = failures([
      ["VulnerabilityReport", ["demo"]],
      ["Pod", ["argocd"]],
    ]);

    expect(readableScope(SCOPE, failed, ["VulnerabilityReport"])).toEqual(["argocd"]);
    expect(readableScope(SCOPE, new Map(), ["VulnerabilityReport"])).toEqual(SCOPE);
  });

  it("knows a kind refused in every namespace from one refused in some", () => {
    const everywhere = failures([["VulnerabilityReport", SCOPE]]);
    const somewhere = failures([["VulnerabilityReport", ["demo"]]]);

    expect(failedEverywhere(everywhere, VULNERABILITIES, SCOPE)).toBe(true);
    expect(failedEverywhere(somewhere, VULNERABILITIES, SCOPE)).toBe(false);
    expect(failedEverywhere(new Map(), VULNERABILITIES, SCOPE)).toBe(false);
    expect(failedEverywhere(everywhere, VULNERABILITIES, [])).toBe(false);
  });

  it("treats a cluster-scoped kind's one refused list as refused everywhere", () => {
    const failed = failures([["ClusterRbacAssessmentReport", [EVERYWHERE]]]);

    expect(failedEverywhere(failed, CLUSTER_ROLES, SCOPE)).toBe(true);
  });

  it("names the namespaces a kind could not be read in", () => {
    expect(unreadIn(failures([["Pod", ["demo"]]]), "Pod")).toEqual(new Set(["demo"]));
    expect(unreadIn(new Map(), "Pod")).toEqual(new Set());
  });
});

describe("saying what could not be read", () => {
  it("lists each kind asked for with its namespaces, and the cluster for a cluster list", () => {
    const failed = failures([
      ["VulnerabilityReport", ["demo", "argocd"]],
      ["ClusterRbacAssessmentReport", [EVERYWHERE]],
      ["Pod", ["demo"]],
    ]);

    const kinds = ["VulnerabilityReport", "ClusterRbacAssessmentReport"];

    expect(describeFailures(failed, kinds)).toBe(
      "Could not read VulnerabilityReports in argocd, demo; ClusterRbacAssessmentReports in the cluster.",
    );
  });

  it("says nothing when everything asked for was read", () => {
    const pods = failures([["Pod", ["demo"]]]);

    expect(describeFailures(pods, ["VulnerabilityReport"])).toBeUndefined();
    expect(describeFailures(failures([["Pod", []]]), ["Pod"])).toBeUndefined();
    expect(describeGap(new Map(), ["Pod"], "So what.")).toBeUndefined();
  });

  it("adds what the gap does to the page", () => {
    const pods = failures([["Pod", ["demo"]]]);

    expect(describeGap(pods, ["Pod"], "Nothing is scaled away.")).toBe(
      "Could not read Pods in demo. Nothing is scaled away.",
    );
  });
});

describe("telling a page when it may show what it has", () => {
  it("waits, rather than shows an empty list, until its own load lands", () => {
    expect(loadState(facts({ loaded: false }))).toBe("connecting");
    expect(loadState(facts({ loaded: false, gaveUp: true }))).toBe("unreachable");
  });

  it("does not show a kind refused in every namespace as an empty one", () => {
    const failed = failures([["VulnerabilityReport", SCOPE]]);

    expect(loadState(facts({ failures: failed }))).toBe("connecting");
    expect(loadState(facts({ failures: failed, gaveUp: true }))).toBe("unreachable");
  });

  it("shows what it has when only some namespaces, or a kind it can do without, failed", () => {
    const somewhere = failures([["VulnerabilityReport", ["demo"]]]);
    const podsEverywhere = failures([["Pod", SCOPE]]);

    expect(loadState(facts({ failures: somewhere }))).toBe("ready");
    expect(loadState(facts({ failures: podsEverywhere, gaveUp: true }))).toBe("ready");
  });

  it("counts a store as loaded only for the scope its own load was for", () => {
    const loaded = [{ isLoaded: true }];

    expect(loadedForScope(loaded, "argocd", "argocd,demo")).toBe(false);
    expect(loadedForScope(loaded, undefined, "argocd")).toBe(false);
    expect(loadedForScope(loaded, "argocd,demo", "argocd,demo")).toBe(true);
    expect(loadedForScope([{ isLoaded: false }], "argocd", "argocd")).toBe(false);
    expect(loadedForScope([undefined], "argocd", "argocd")).toBe(true);
  });
});

describe("deciding after a load pass what watches and what lists again", () => {
  const listed = (kind: string) => ({ kind, isLoaded: true });
  const unlisted = (kind: string) => ({ kind, isLoaded: false });

  it("watches a kind whose list landed while another is still unlisted", () => {
    const pass = [listed("VulnerabilityReport"), unlisted("Pod")];
    const outcome = afterPass(pass, pass, new Map());

    expect(outcome.watch).toEqual(["VulnerabilityReport"]);
    expect(outcome.retry).toEqual(["Pod"]);
    expect(outcome.settled).toBe(false);
  });

  it("lists again only the kinds that are unlisted or were refused somewhere", () => {
    const pass = [listed("VulnerabilityReport"), listed("ConfigAuditReport"), listed("Pod")];
    const outcome = afterPass(pass, pass, failures([["Pod", ["demo"]]]));

    expect(outcome.watch).toEqual(["VulnerabilityReport", "ConfigAuditReport", "Pod"]);
    expect(outcome.retry).toEqual(["Pod"]);
    expect(outcome.settled).toBe(true);
  });

  it("lists again a kind outside the pass that the host emptied since", () => {
    const outcome = afterPass(
      [listed("Pod")],
      [unlisted("VulnerabilityReport"), listed("Pod")],
      new Map(),
    );

    expect(outcome.watch).toEqual(["Pod"]);
    expect(outcome.retry).toEqual(["VulnerabilityReport"]);
    expect(outcome.settled).toBe(false);
  });

  it("names an unlisted kind that was also refused once", () => {
    const pass = [unlisted("Pod")];

    expect(afterPass(pass, pass, failures([["Pod", SCOPE]])).retry).toEqual(["Pod"]);
  });

  it("stops once every kind has listed and none was refused", () => {
    const pass = [listed("VulnerabilityReport"), listed("Pod")];

    expect(afterPass(pass, pass, new Map())).toEqual({
      watch: ["VulnerabilityReport", "Pod"],
      retry: [],
      settled: true,
    });
  });
});
