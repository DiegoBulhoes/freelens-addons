import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";

import {
  getChildrenOf,
  getCompareUrl,
  getParentOf,
  getParentsOf,
  groupDeploysByRevision,
} from "../src/renderer/api/insights";
import { getRecentDeploys } from "../src/renderer/api/overview";
import { application, applications, statusOf, variantOf } from "./fixtures";

describe("relationships the data holds but no single status shows", () => {
  it("finds the app-of-apps that manages the others", () => {
    const all = applications();
    const parents = all.filter((candidate) => getChildrenOf(candidate, all).length > 0);

    expect(parents.length).toBeGreaterThan(0);

    const children = getChildrenOf(parents[0] as (typeof parents)[number], all);

    expect(children.length).toBeGreaterThan(1);
  });

  it("finds the parent of a managed Application, and agrees with the child list", () => {
    const all = applications();
    const managed = all.find((candidate) => getParentOf(candidate, all) !== undefined);

    expect(managed, "the fixtures should contain an app-of-apps layout").toBeDefined();

    const parent = getParentOf(managed as (typeof all)[number], all);

    expect(parent).toBeDefined();
    expect(getChildrenOf(parent as (typeof all)[number], all)).toContain(managed);
  });

  it("groups a fleet-wide rollout into one event rather than many", () => {
    const cohorts = groupDeploysByRevision(getRecentDeploys(applications(), 60));

    expect(cohorts.length).toBeGreaterThan(0);
    expect(cohorts.some((cohort) => cohort.entries.length > 1)).toBe(true);

    for (let index = 1; index < cohorts.length; index += 1) {
      expect(cohorts[index - 1]?.at).toBeGreaterThanOrEqual(cohorts[index]?.at ?? 0);
    }
  });

  it("builds a compare link between the last two deploys", () => {
    const withHistory = applications().filter(
      (candidate) => getCompareUrl(candidate) !== undefined,
    );

    expect(
      withHistory.length,
      "the fixtures should contain two deploys of one repo",
    ).toBeGreaterThan(0);

    for (const candidate of withHistory) {
      expect(getCompareUrl(candidate)).toMatch(
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/compare\/[0-9a-f]+\.\.\.[0-9a-f]+$/,
      );
    }
  });
});

describe("relationships that are not there", () => {
  it("reports no parent for an Application nothing manages", () => {
    const all = applications();
    const orphan = all.find((candidate) => getParentOf(candidate, all) === undefined);

    expect(orphan).toBeDefined();
    expect(getParentOf(orphan as (typeof all)[number], [])).toBeUndefined();
  });

  it("reports no children for an Application that manages none", () => {
    expect(getChildrenOf(application("guestbook"), applications())).toEqual([]);
  });

  it("offers no compare link with fewer than two deploys", () => {
    const single = variantOf("guestbook", (data) => {
      statusOf(data).history = [{ id: 1, revision: "abc1234" }];
    });

    expect(getCompareUrl(single)).toBeUndefined();
  });

  it("offers no compare link when both deploys carry the same revision", () => {
    const unchanged = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        { id: 1, revision: "abc1234" },
        { id: 2, revision: "abc1234" },
      ];
    });

    expect(getCompareUrl(unchanged)).toBeUndefined();
  });

  it("offers no compare link for a host whose compare URL is unknown", () => {
    const elsewhere = variantOf("guestbook", (data) => {
      const source = data.spec.source as { repoURL?: string } | undefined;

      if (source) source.repoURL = "https://git.example.test/org/repo.git";

      statusOf(data).history = [
        { id: 1, revision: "abc1234" },
        { id: 2, revision: "def5678" },
      ];
    });

    expect(getCompareUrl(elsewhere)).toBeUndefined();
  });
});

describe("relationships given nonsense", () => {
  it("does not claim an Application is its own parent", () => {
    const all = applications();

    for (const candidate of all) {
      expect(getParentOf(candidate, all)).not.toBe(candidate);
    }
  });

  it("groups deploys with no revision under a single placeholder", () => {
    const cohorts = groupDeploysByRevision([
      { application: application("guestbook"), id: 1, at: 2, revisions: [], by: "automated" },
      { application: application("podinfo"), id: 1, at: 1, revisions: [], by: "automated" },
    ]);

    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.revision).toBe("—");
    // The cohort's time is the most recent of its members, not the first seen.
    expect(cohorts[0]?.at).toBe(2);
  });

  it("prefers the git SHA over a chart version when a deploy carries both", () => {
    const [cohort] = groupDeploysByRevision([
      {
        application: application("guestbook"),
        id: 1,
        at: 1,
        revisions: ["9.9.9", "abcdef1234567"],
        by: "automated",
      },
    ]);

    expect(cohort?.revision).toBe("abcdef1234567");
  });

  it("builds a compare link from an ssh remote as well as an https one", () => {
    for (const [repoURL, expected] of [
      ["git@github.com:org/repo.git", "https://github.com/org/repo"],
      ["https://gitlab.com/group/repo.git", "https://gitlab.com/group/repo"],
    ] as const) {
      const target = variantOf("guestbook", (data) => {
        data.spec.sources = undefined;
        data.spec.source = { repoURL, path: ".", targetRevision: "main" };
        statusOf(data).history = [
          { id: 1, revision: "aaaaaaa" },
          { id: 2, revision: "bbbbbbb" },
        ];
      });

      expect(getCompareUrl(target)).toBe(`${expected}/compare/aaaaaaa...bbbbbbb`);
    }
  });

  it("matches a managed Application whose resource entry omits the namespace", () => {
    const child = application("guestbook");
    const parent = variantOf("apps", (data) => {
      statusOf(data).resources = [{ kind: "Application", name: child.getName(), status: "Synced" }];
    });

    // ArgoCD leaves the namespace off when it is the Application's own, so a
    // strict comparison would lose the whole app-of-apps link.
    expect(getChildrenOf(parent, [child])).toEqual([child]);
    expect(getParentOf(child, [parent, child])).toBe(parent);
  });

  it("reads a multi-source history entry's revisions when building the link", () => {
    const multi = variantOf("guestbook", (data) => {
      data.spec.sources = undefined;
      data.spec.source = {
        repoURL: "https://github.com/org/repo.git",
        path: ".",
        targetRevision: "main",
      };
      statusOf(data).history = [
        { id: 1, revisions: ["1111111", "v1"] },
        { id: 2, revisions: ["2222222", "v2"] },
      ];
    });

    expect(getCompareUrl(multi)).toBe("https://github.com/org/repo/compare/1111111...2222222");
  });

  it("offers no link for a repository URL it cannot turn into a web address", () => {
    const bare = variantOf("guestbook", (data) => {
      data.spec.sources = undefined;
      // Names github, so it passes the host check, but has no scheme to strip.
      data.spec.source = { repoURL: "github.com/org/repo", path: ".", targetRevision: "main" };
      statusOf(data).history = [
        { id: 1, revision: "aaaaaaa" },
        { id: 2, revision: "bbbbbbb" },
      ];
    });

    expect(getCompareUrl(bare)).toBeUndefined();
  });

  it("offers no compare link when neither deploy carries a git revision", () => {
    const chartOnly = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        { id: 1, revision: "1.2.3" },
        { id: 2, revision: "1.2.4" },
      ];
    });

    expect(getCompareUrl(chartOnly)).toBeUndefined();
  });

  it("returns nothing for an empty timeline", () => {
    expect(groupDeploysByRevision([])).toEqual([]);
  });
});

describe("the parent index against the scan it replaces", () => {
  /**
   * The scan as it was before the index, kept here as the oracle. If the two
   * ever disagree on any input, the index is wrong — that is the whole point
   * of this suite, and `??` falling back on null as well as undefined is where
   * a hand-rolled index would have diverged.
   */
  function scanForParent(application: Application, all: Application[]): Application | undefined {
    const name = application.getName();
    const namespace = application.getNs();

    return all.find((candidate) => {
      if (candidate === application) return false;

      return Application.getManagedResources(candidate).some(
        (resource) =>
          resource.kind === "Application" &&
          resource.name === name &&
          (resource.namespace ?? namespace) === namespace,
      );
    });
  }

  it("agrees with the scan for every Application in the cluster", () => {
    const all = applications();

    for (const application of all) {
      expect(getParentOf(application, all)).toBe(scanForParent(application, all));
    }
  });

  it("answers a whole page in one pass, agreeing row by row", () => {
    const all = applications();
    const page = all.slice(0, 8);
    const parents = getParentsOf(page, all);

    for (const application of page) {
      expect(parents.get(application)).toBe(scanForParent(application, all));
    }
  });

  it("gives every child of the app-of-apps its root as parent, and the root none", () => {
    const all = applications();
    const root = all.find((candidate) => candidate.getName() === "apps");

    if (!root) throw new Error("the fixtures should contain the app-of-apps root");

    const children = getChildrenOf(root, all);

    expect(children.length, "the fixtures should contain an app-of-apps layout").toBeGreaterThan(0);

    for (const child of children) expect(getParentOf(child, all)).toBe(root);

    expect(getParentOf(root, all)).toBeUndefined();
  });
});

describe("the parent index on resource entries the cluster has not produced", () => {
  const childOf = (namespace: string | undefined) =>
    variantOf("guestbook", (data) => {
      data.metadata.namespace = namespace;
      data.metadata.uid = `child-${namespace}`;
      data.metadata.selfLink = `/apis/argoproj.io/v1alpha1/namespaces/${namespace}/applications/guestbook`;
    });

  const parentDeclaring = (resource: Record<string, unknown>) =>
    variantOf("apps", (data) => {
      statusOf(data).resources = [{ kind: "Application", name: "guestbook", ...resource }];
    });

  it("treats a null namespace the same way `??` does, not as a missing key", () => {
    // `(resource.namespace ?? namespace) === namespace` falls back on null too,
    // so a null entry matches the child's own namespace exactly as undefined does.
    const child = childOf("argocd");
    const parent = parentDeclaring({ namespace: null });

    expect(getParentsOf([child], [parent, child]).get(child)).toBe(parent);
  });

  it("treats an absent namespace the same way", () => {
    const child = childOf("argocd");
    const parent = parentDeclaring({});

    expect(getParentsOf([child], [parent, child]).get(child)).toBe(parent);
  });

  it("does not match a namespace that is present and different", () => {
    const child = childOf("argocd");
    const parent = parentDeclaring({ namespace: "somewhere-else" });

    expect(getParentsOf([child], [parent, child]).get(child)).toBeUndefined();
  });

  it("does not match an empty name by truthiness", () => {
    // A filter on `resource.name` would drop this entry; the scan compares it.
    const child = childOf("argocd");
    const parent = parentDeclaring({ name: "" });

    expect(getParentsOf([child], [parent, child]).get(child)).toBeUndefined();
  });

  it("never reports an Application as its own parent", () => {
    const selfReferential = variantOf("apps", (data) => {
      statusOf(data).resources = [
        { kind: "Application", name: "apps", namespace: "argocd", status: "Synced" },
      ];
    });

    expect(getParentsOf([selfReferential], [selfReferential]).get(selfReferential)).toBeUndefined();
  });

  it("asks nothing of the fleet when no rows are being shown", () => {
    const all = applications();

    expect(getParentsOf([], all).size).toBe(0);
  });
});
