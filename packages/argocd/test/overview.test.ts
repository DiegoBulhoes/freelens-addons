import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";
import {
  getAttentionItems,
  getCounts,
  getRecentDeploys,
  getRepeatedSyncs,
  getSyncWave,
  STALE_RECONCILE_MINUTES,
  STUCK_SYNC_MINUTES,
} from "../src/renderer/api/overview";
import { applications, appProjects, fixtureNow, statusOf, variantOf } from "./fixtures";

const NOW = fixtureNow();
const MINUTE = 60_000;

describe("the overview, against the cluster as it was", () => {
  it("counts every Application exactly once across sync and health", () => {
    const all = applications();
    const counts = getCounts(all, appProjects());

    expect(counts.applications).toBe(all.length);
    expect(Object.values(counts.sync).reduce((a, b) => a + b, 0)).toBe(all.length);
    expect(Object.values(counts.health).reduce((a, b) => a + b, 0)).toBe(all.length);
    expect(counts.projects).toBe(appProjects().length);
  });

  it("flags the Applications that were out of sync, and not the ones that were not", () => {
    const items = getAttentionItems(applications(), NOW);
    const flagged = new Set(items.map((item) => item.application.getName()));
    const outOfSync = applications().filter(
      (candidate) => Application.getSyncStatus(candidate) === "OutOfSync",
    );

    expect(outOfSync.length).toBeGreaterThan(0);

    for (const candidate of outOfSync) {
      expect(flagged).toContain(candidate.getName());
    }

    expect(flagged).not.toContain("guestbook");
  });

  it("names which resources differ, not only how many", () => {
    const drifting = getAttentionItems(applications(), NOW).find(
      (item) => item.headline === "OutOfSync",
    );

    expect(drifting).toBeDefined();
    expect(drifting?.drifting?.length).toBeGreaterThan(0);
    // "Kind/name", which is what the operator has to go and look at.
    expect(drifting?.drifting?.[0]).toMatch(/^[A-Za-z]+\/\S+/);
  });

  it("orders critical before warning, and low sync waves before high ones", () => {
    const items = getAttentionItems(applications(), NOW);
    const rank = { critical: 0, warning: 1, info: 2 } as const;

    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];

      if (!previous || !current) continue;

      expect(rank[previous.severity]).toBeLessThanOrEqual(rank[current.severity]);

      if (previous.severity === current.severity) {
        const before = previous.wave ?? Number.MAX_SAFE_INTEGER;
        const after = current.wave ?? Number.MAX_SAFE_INTEGER;

        expect(before).toBeLessThanOrEqual(after);
      }
    }
  });

  it("reads the sync wave the annotation carries", () => {
    const waved = applications().find((candidate) => getSyncWave(candidate) !== undefined);

    expect(waved, "the fixtures should contain a sync-wave annotation").toBeDefined();
    expect(Number.isInteger(getSyncWave(waved as Application))).toBe(true);
  });

  it("builds a deploy timeline newest first, from history rather than events", () => {
    const deploys = getRecentDeploys(applications(), 40);

    expect(deploys.length).toBeGreaterThan(0);

    for (let index = 1; index < deploys.length; index += 1) {
      expect(deploys[index - 1]?.at).toBeGreaterThanOrEqual(deploys[index]?.at ?? 0);
    }

    expect(deploys.every((entry) => entry.revisions.length > 0)).toBe(true);
  });

  it("finds the Applications that deployed over and over in the last hour", () => {
    const repeated = getRepeatedSyncs(applications(), { now: NOW });

    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.every((entry) => entry.count >= 3)).toBe(true);

    for (let index = 1; index < repeated.length; index += 1) {
      expect(repeated[index - 1]?.count).toBeGreaterThanOrEqual(repeated[index]?.count ?? 0);
    }
  });
});

describe("the overview, when something is wrong", () => {
  it("calls a long-running sync stuck rather than in progress", () => {
    const stuck = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.operationState = {
        phase: "Running",
        startedAt: new Date(NOW - (STUCK_SYNC_MINUTES + 5) * MINUTE).toISOString(),
      };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    const [item] = getAttentionItems([stuck], NOW);

    expect(item?.headline).toBe("Sync stuck");
    expect(item?.severity).toBe("critical");
  });

  it("notices when the controller has stopped looking at an Application", () => {
    const abandoned = variantOf("guestbook", (data) => {
      statusOf(data).reconciledAt = new Date(
        NOW - (STALE_RECONCILE_MINUTES + 10) * MINUTE,
      ).toISOString();
    });

    const [item] = getAttentionItems([abandoned], NOW);

    expect(item?.headline).toBe("Not reconciled");
  });

  // What ArgoCD writes when a targetRevision names a branch that does not exist:
  // health stays Healthy, sync goes Unknown, and only the condition says why.
  it("surfaces an Application ArgoCD cannot compare with git", () => {
    const unreadable = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.health = { status: "Healthy" };
      status.sync = { status: "Unknown" };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      status.conditions = [
        {
          type: "ComparisonError",
          message:
            "Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = unable to resolve 'no-such-branch' to a commit SHA",
          lastTransitionTime: new Date(NOW - 5 * MINUTE).toISOString(),
        },
      ];
    });

    const [item] = getAttentionItems([unreadable], NOW);

    expect(item?.headline).toBe("Git error");
    expect(item?.severity).toBe("critical");
    expect(item?.detail).toContain("no-such-branch");
  });

  it("names an invalid spec, and ignores a condition that is only a warning", () => {
    const invalid = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      status.conditions = [
        {
          type: "InvalidSpecError",
          message: "application destination can't have both name and server defined",
        },
      ];
    });
    const warned = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      status.conditions = [{ type: "OrphanedResourceWarning", message: "1 orphaned resource" }];
    });

    expect(getAttentionItems([invalid], NOW)[0]?.headline).toBe("Invalid spec");
    expect(getAttentionItems([warned], NOW)).toEqual([]);
  });

  it("surfaces a failed sync even when health recovered on its own", () => {
    const failed = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.health = { status: "Healthy" };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      status.operationState = {
        phase: "Failed",
        message: "one or more objects failed to apply",
        finishedAt: new Date(NOW - 2 * MINUTE).toISOString(),
      };
    });

    const [item] = getAttentionItems([failed], NOW);

    expect(item?.headline).toBe("Last sync failed");
    expect(item?.detail).toContain("failed to apply");
  });

  it("ranks Degraded above everything, before it even looks at the sync state", () => {
    const degraded = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.health = { status: "Degraded", message: "pods are crash-looping" };
      status.sync = { status: "OutOfSync" };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    const [item] = getAttentionItems([degraded], NOW);

    expect(item?.headline).toBe("Degraded");
    expect(item?.detail).toBe("pods are crash-looping");
  });

  it("surfaces a Progressing Application below the ones that are broken", () => {
    const progressing = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.health = { status: "Progressing", message: "waiting for rollout" };
      status.sync = { status: "Synced" };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    const [item] = getAttentionItems([progressing], NOW);

    expect(item?.headline).toBe("Progressing");
    expect(item?.severity).toBe("info");
    expect(item?.detail).toBe("waiting for rollout");
  });

  it("surfaces a Suspended Application, which is deliberate but easy to forget", () => {
    const suspended = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.health = { status: "Suspended" };
      status.sync = { status: "Synced" };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    const [item] = getAttentionItems([suspended], NOW);

    expect(item?.headline).toBe("Suspended");
    expect(item?.severity).toBe("info");
  });

  it("says only that it differs from git when the resource list is empty", () => {
    const vague = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.sync = { status: "OutOfSync" };
      status.resources = [];
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    const [item] = getAttentionItems([vague], NOW);

    expect(item?.detail).toBe("differs from git");
    expect(item?.drifting).toEqual([]);
  });

  it("does not call a sync stuck while it is still within the window", () => {
    const busy = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.operationState = {
        phase: "Running",
        startedAt: new Date(NOW - (STUCK_SYNC_MINUTES - 1) * MINUTE).toISOString(),
      };
      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
    });

    expect(getAttentionItems([busy], NOW)).toEqual([]);
  });

  it("treats an Errored sync the same as a failed one", () => {
    const errored = variantOf("guestbook", (data) => {
      const status = statusOf(data);

      status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      status.operationState = { phase: "Error", finishedAt: new Date(NOW).toISOString() };
    });

    expect(getAttentionItems([errored], NOW)[0]?.headline).toBe("Last sync error");
  });

  it("names a deploy by the person who started it when it was not automated", () => {
    const byHand = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        {
          id: 1,
          revision: "abc1234",
          deployedAt: new Date(NOW - MINUTE).toISOString(),
          initiatedBy: { username: "diego" },
        },
        {
          id: 2,
          revision: "def5678",
          deployedAt: new Date(NOW - 2 * MINUTE).toISOString(),
          initiatedBy: {},
        },
      ];
    });

    const deploys = getRecentDeploys([byHand]);

    expect(deploys[0]?.by).toBe("diego");
    expect(deploys[1]?.by).toBe("unknown");
  });

  it("counts an Application with no automated policy as one that will not self-heal", () => {
    const manual = variantOf("guestbook", (data) => {
      delete data.spec.syncPolicy;
    });

    expect(getCounts([manual], []).manualOnly).toBe(1);
  });
});

describe("the overview, given data that makes no sense", () => {
  it("ignores a sync wave that is not a number", () => {
    const nonsense = variantOf("guestbook", (data) => {
      (data.metadata.annotations as Record<string, string>)["argocd.argoproj.io/sync-wave"] =
        "soon";
    });

    expect(getSyncWave(nonsense)).toBeUndefined();
  });

  it("leaves an Application with no annotations without a wave", () => {
    const bare = variantOf("guestbook", (data) => {
      delete data.metadata.annotations;
    });

    expect(getSyncWave(bare)).toBeUndefined();
  });

  it("skips history entries whose timestamp cannot be parsed", () => {
    const broken = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        { id: 1, revision: "abc", deployedAt: "whenever" },
        { id: 2, revision: "def", deployedAt: new Date(NOW - MINUTE).toISOString() },
      ];
    });

    const deploys = getRecentDeploys([broken]);

    expect(deploys).toHaveLength(1);
    expect(deploys[0]?.id).toBe(2);
  });

  it("does not treat an unparseable reconciledAt as staleness", () => {
    const garbled = variantOf("guestbook", (data) => {
      statusOf(data).reconciledAt = "not a date";
    });

    expect(getAttentionItems([garbled], NOW)).toEqual([]);
  });

  it("falls back to the name when severity and wave are identical", () => {
    const outOfSync = (name: string) =>
      variantOf("guestbook", (data) => {
        data.metadata.name = name;
        data.metadata.uid = name;
        data.metadata.selfLink = `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${name}`;
        data.metadata.annotations = { "argocd.argoproj.io/sync-wave": "1" };

        const status = statusOf(data);

        status.sync = { status: "OutOfSync" };
        status.resources = [];
        status.reconciledAt = new Date(NOW - MINUTE).toISOString();
      });

    const items = getAttentionItems([outOfSync("zebra"), outOfSync("alpha")], NOW);

    expect(items.map((item) => item.application.getName())).toEqual(["alpha", "zebra"]);
  });

  it("returns empty structures for an empty cluster rather than throwing", () => {
    expect(getAttentionItems([], NOW)).toEqual([]);
    expect(getRecentDeploys([])).toEqual([]);
    expect(getRepeatedSyncs([], { now: NOW })).toEqual([]);
    expect(getCounts([], []).applications).toBe(0);
  });

  it("skips a history entry with no timestamp at all", () => {
    const undated = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        { id: 1, revision: "abc1234" },
        { id: 2, revision: "def5678", deployedAt: new Date(NOW - MINUTE).toISOString() },
      ];
    });

    expect(getRecentDeploys([undated]).map((entry) => entry.id)).toEqual([2]);
    expect(getRepeatedSyncs([undated], { now: NOW, threshold: 1 })[0]?.count).toBe(1);
  });

  it("reads a multi-source deploy's revisions into the timeline", () => {
    const multi = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        {
          id: 1,
          revisions: ["abc1234", "v1.0.0"],
          deployedAt: new Date(NOW - MINUTE).toISOString(),
          initiatedBy: { automated: true },
        },
      ];
    });

    expect(getRecentDeploys([multi])[0]?.revisions).toEqual(["abc1234", "v1.0.0"]);
  });

  it("reports a floor, not a total, when ArgoCD's history limit has been hit", () => {
    const capped = variantOf("guestbook", (data) => {
      statusOf(data).history = [1, 2, 3, 4].map((id) => ({
        id,
        revision: `rev${id}`,
        deployedAt: new Date(NOW - id * MINUTE).toISOString(),
      }));
    });

    const [entry] = getRepeatedSyncs([capped], { now: NOW });

    expect(entry?.count).toBe(4);
    expect(entry?.capped).toBe(true);
  });

  it("reports an uncapped count when older history is still present", () => {
    const roomy = variantOf("guestbook", (data) => {
      statusOf(data).history = [
        { id: 1, revision: "old", deployedAt: new Date(NOW - 5 * 60 * MINUTE).toISOString() },
        ...[2, 3, 4].map((id) => ({
          id,
          revision: `rev${id}`,
          deployedAt: new Date(NOW - id * MINUTE).toISOString(),
        })),
      ];
    });

    const [entry] = getRepeatedSyncs([roomy], { now: NOW });

    expect(entry?.count).toBe(3);
    expect(entry?.capped).toBe(false);
  });
});
