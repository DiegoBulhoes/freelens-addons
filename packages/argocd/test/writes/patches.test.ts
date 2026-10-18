import { describe, expect, it } from "vitest";
import type { RevisionHistory } from "../../src/renderer/api/shared/types";
import {
  AUTO_SYNC_BEFORE_ROLLBACK,
  autoSyncOf,
  autoSyncToResume,
  deployOf,
  describeAutoSync,
  describeRollback,
  disableAutoSyncPatch,
  isRiskyChoice,
  isRollbackTarget,
  isSyncRunning,
  operationInProgress,
  operationRefusal,
  planResumeAutoSync,
  planRollback,
  planSync,
  REFRESH_ANNOTATION,
  refreshPatch,
  resumeAutoSyncPatch,
  rollbackPatch,
  rollbackRevertedBy,
  rollbackTargetsOf,
  syncPatch,
  terminatePatch,
  wasForced,
  withResourceVersion,
} from "../../src/renderer/api/writes/patches";
import { application, applications, statusOf, variantOf } from "../support/fixtures";

describe("patches — what gets written", () => {
  it("asks for a refresh with the annotation the controller watches", () => {
    expect(refreshPatch("normal")).toEqual({
      metadata: { annotations: { [REFRESH_ANNOTATION]: "normal" } },
    });
    expect(refreshPatch("hard").metadata.annotations[REFRESH_ANNOTATION]).toBe("hard");
  });

  it("starts a sync without pinning a revision", () => {
    const patch = syncPatch({ prune: false });

    expect(patch.operation.sync).toEqual({ prune: false });
    // A pinned revision would re-apply the last sync instead of the source's head.
    expect(patch.operation.sync).not.toHaveProperty("revision");
    expect(patch.operation.initiatedBy).toEqual({ username: "freelens" });
  });

  it("carries prune through only when it was asked for", () => {
    expect(syncPatch({ prune: true }).operation.sync.prune).toBe(true);
    expect(syncPatch({ prune: false }).operation.sync.prune).toBe(false);
  });

  it("forces on the hook strategy, as ArgoCD's own UI does, and only when asked", () => {
    expect(syncPatch({ prune: true, force: true }).operation.sync).toEqual({
      prune: true,
      syncStrategy: { hook: { force: true } },
    });
    expect(syncPatch({ prune: false, force: false }).operation.sync).toEqual({ prune: false });
  });

  it("recognises a forced sync by either strategy", () => {
    expect(wasForced({ syncStrategy: { hook: { force: true } } })).toBe(true);
    expect(wasForced({ syncStrategy: { apply: { force: true } } })).toBe(true);
    expect(wasForced({ syncStrategy: { hook: {} } })).toBe(false);
    expect(wasForced({})).toBe(false);
    expect(wasForced(undefined)).toBe(false);
  });

  it("terminates by marking the operation Terminating, keeping the operation itself", () => {
    // Clearing `operation` only stops the controller tracking it; the sync runs on to the end.
    expect(terminatePatch()).toEqual({ status: { operationState: { phase: "Terminating" } } });
  });

  it("turns automated sync off with an explicit null", () => {
    // `undefined` is dropped from JSON; only null removes the field.
    expect(disableAutoSyncPatch().spec.syncPolicy.automated).toBeNull();
  });

  it("records why a rollback happened where ArgoCD shows it", () => {
    const deploy = deployOf(application("guestbook"), 21);
    if (!deploy) throw new Error("guestbook has no deploy #21 in the fixtures");

    const patch = rollbackPatch(deploy, { autoSync: undefined });

    expect(patch.operation.info).toEqual([{ name: "Reason", value: "Rollback to deploy #21" }]);
  });
});

describe("rolling back — the operation argocd-server would build", () => {
  const deployOrFail = (name: string, id: number) => {
    const deploy = deployOf(application(name), id);
    if (!deploy) throw new Error(`${name} has no deploy #${id} in the fixtures`);

    return deploy;
  };

  it("syncs a multi-source deploy's own sources and revisions, not the spec's", () => {
    const deploy = deployOrFail("podinfo", 0);
    const { sync } = rollbackPatch(deploy, { autoSync: { selfHeal: true } }).operation;

    // `revision` alone is ignored for spec.sources: ArgoCD would deploy the current targets.
    expect(sync).toEqual({ revisions: deploy.revisions, sources: deploy.sources });
    expect(sync).not.toHaveProperty("revision");
  });

  it("syncs a single-source deploy's own source at its revision", () => {
    const deploy = deployOrFail("guestbook", 21);

    expect(rollbackPatch(deploy, { autoSync: { selfHeal: true } }).operation.sync).toEqual({
      revision: "5c2d89b897c4df42e06f94622f857dc4d7adc8f8",
      source: deploy.source,
    });
  });

  it("turns automated sync off in the same write as the rollback, or not at all", () => {
    const deploy = deployOrFail("guestbook", 21);

    expect(
      rollbackPatch(deploy, { autoSync: { selfHeal: true } }).spec?.syncPolicy.automated,
    ).toBeNull();
    expect(rollbackPatch(deploy, { autoSync: undefined })).not.toHaveProperty("spec");
  });
});

describe("rolling back — which deploys can be reached", () => {
  const withHistory = (history: RevisionHistory[]) =>
    variantOf("guestbook", (data) => {
      statusOf(data).history = history;
    });

  it("offers the deploys before the current one, newest first", () => {
    expect(rollbackTargetsOf(application("guestbook"), 3).map((deploy) => deploy.id)).toEqual([
      25, 24, 23,
    ]);
  });

  it("offers nothing when only the current deploy is recorded", () => {
    expect(rollbackTargetsOf(application("podinfo"), 3)).toEqual([]);
  });

  it("skips a deploy recorded without an id, a revision or a source", () => {
    const real = application("guestbook").status?.history ?? [];
    const [first, second, third, current] = real.slice(-4) as RevisionHistory[];
    const ragged = withHistory([
      { ...first },
      { ...second, revision: undefined },
      { ...third, id: undefined },
      { ...current },
    ]);

    expect(rollbackTargetsOf(ragged, 3).map((deploy) => deploy.id)).toEqual([first?.id]);
  });

  it("refuses a deploy whose source ArgoCD did not record", () => {
    const [podinfoDeploy] = application("podinfo").status?.history ?? [];

    // podinfo records an empty `source` beside its `sources`: the empty one alone is not enough.
    expect(isRollbackTarget({ ...podinfoDeploy, sources: undefined })).toBe(false);
    expect(isRollbackTarget(podinfoDeploy)).toBe(true);
    expect(isRollbackTarget(undefined)).toBe(false);
  });

  it("finds no deploy for an id that is not there, or an Application with no history", () => {
    expect(deployOf(application("podinfo"), 999_999)).toBeUndefined();

    const empty = variantOf("podinfo", (data) => {
      delete data.status;
    });

    expect(deployOf(empty, 0)).toBeUndefined();
    expect(rollbackTargetsOf(empty, 3)).toEqual([]);
  });
});

describe("an operation already running", () => {
  const withPhase = (phase: string) =>
    variantOf("guestbook", (data) => {
      (statusOf(data).operationState as Record<string, unknown>).phase = phase;
    });

  it("finds none in the fixtures, whose operations have all finished", () => {
    for (const each of applications()) expect(operationInProgress(each)).toBe(false);
  });

  it("counts a requested operation the controller has not picked up yet", () => {
    const requested = variantOf("guestbook", (data) => {
      (data as unknown as Record<string, unknown>).operation = { sync: { prune: false } };
    });

    expect(operationInProgress(requested)).toBe(true);
  });

  it("counts a running or terminating phase, and not a finished one", () => {
    expect(operationInProgress(withPhase("Running"))).toBe(true);
    expect(operationInProgress(withPhase("Terminating"))).toBe(true);
    expect(operationInProgress(withPhase("Failed"))).toBe(false);
  });

  it("refuses with the Application's name, and not when it is idle", () => {
    expect(operationRefusal(withPhase("Running"))).toBe(
      "guestbook already has an operation running. Wait for it, or terminate it.",
    );
    expect(operationRefusal(application("guestbook"))).toBeUndefined();
  });

  it("sends the version it read, so a change since makes the write fail", () => {
    const read = application("guestbook");
    const patch = withResourceVersion(syncPatch({ prune: false }), read.getResourceVersion());

    expect(patch).toEqual({
      ...syncPatch({ prune: false }),
      metadata: { resourceVersion: read.getResourceVersion() },
    });
    expect(read.getResourceVersion()).toBeTruthy();
    expect(withResourceVersion(syncPatch({ prune: false }), undefined)).toEqual(
      syncPatch({ prune: false }),
    );
  });
});

describe("rolling back — automated sync, kept so it can be put back", () => {
  const deploy = () => {
    const found = deployOf(application("guestbook"), 21);
    if (!found) throw new Error("guestbook has no deploy #21 in the fixtures");

    return found;
  };

  /** guestbook as the API server holds it once the rollback patch has landed. */
  const rolledBack = () =>
    variantOf("guestbook", (data) => {
      const patch = rollbackPatch(deploy(), { autoSync: autoSyncOf(application("guestbook")) });

      data.metadata.annotations = {
        ...(data.metadata.annotations as Record<string, string> | undefined),
        ...patch.metadata?.annotations,
      };
      (data.spec.syncPolicy as Record<string, unknown>).automated = null;
    });

  it("turns off only an automated sync that is on, enabled or not said", () => {
    expect(autoSyncOf(application("guestbook"))).toEqual({ selfHeal: true });
    expect(autoSyncOf(application("apps"))).toEqual({ prune: true, selfHeal: true });
    expect(autoSyncOf(application("helm-guestbook"))).toBeUndefined();
    expect(
      autoSyncOf(
        variantOf("guestbook", (data) => {
          (data.spec.syncPolicy as Record<string, unknown>).automated = {
            enabled: false,
            selfHeal: true,
          };
        }),
      ),
    ).toBeUndefined();
  });

  it("records the block it turns off in the same write, on the Application", () => {
    const patch = rollbackPatch(deploy(), { autoSync: { prune: true, selfHeal: true } });

    expect(patch.spec?.syncPolicy.automated).toBeNull();
    expect(JSON.parse(patch.metadata?.annotations[AUTO_SYNC_BEFORE_ROLLBACK] ?? "")).toEqual({
      prune: true,
      selfHeal: true,
    });
    expect(rollbackPatch(deploy(), { autoSync: undefined })).not.toHaveProperty("metadata");
  });

  it("offers that block back while automated sync stays off", () => {
    const saved = autoSyncToResume(rolledBack());

    expect(saved).toEqual({ selfHeal: true });
    expect(resumeAutoSyncPatch({ selfHeal: true })).toEqual({
      metadata: { annotations: { [AUTO_SYNC_BEFORE_ROLLBACK]: null } },
      spec: { syncPolicy: { automated: { selfHeal: true } } },
    });
  });

  it("offers nothing once automated sync is on again, or without a readable record", () => {
    const withRecord = (record: string) =>
      variantOf("helm-guestbook", (data) => {
        data.metadata.annotations = { [AUTO_SYNC_BEFORE_ROLLBACK]: record };
      });

    expect(autoSyncToResume(application("helm-guestbook"))).toBeUndefined();
    expect(
      autoSyncToResume(
        variantOf("guestbook", (data) => {
          data.metadata.annotations = { [AUTO_SYNC_BEFORE_ROLLBACK]: '{"prune":true}' };
        }),
      ),
    ).toBeUndefined();
    expect(autoSyncToResume(withRecord("{}"))).toEqual({});
    for (const unreadable of ["not json", "[1]", "null", "3"]) {
      expect(autoSyncToResume(withRecord(unreadable)), unreadable).toBeUndefined();
    }
  });

  it("keeps the record's annotation when it adds the version it read", () => {
    expect(withResourceVersion(resumeAutoSyncPatch({}), "42")).toEqual({
      metadata: { annotations: { [AUTO_SYNC_BEFORE_ROLLBACK]: null }, resourceVersion: "42" },
      spec: { syncPolicy: { automated: {} } },
    });
  });

  it("names what it turns off", () => {
    expect(describeAutoSync({})).toBe("automated sync");
    expect(describeAutoSync({ selfHeal: true })).toBe("automated sync with self-heal");
    expect(describeAutoSync({ prune: true, selfHeal: true })).toBe(
      "automated sync with prune and self-heal",
    );
  });
});

describe("rolling back — something that would put automated sync back", () => {
  const generated = (name: string) =>
    variantOf(name, (data) => {
      data.metadata.ownerReferences = [
        {
          apiVersion: "argoproj.io/v1alpha1",
          kind: "ApplicationSet",
          name: "guestbooks",
          uid: "00000000-0000-0000-0000-000000000000",
          controller: true,
        },
      ];
    });

  it("warns that a self-healing parent puts it back from git", () => {
    expect(rollbackRevertedBy(application("example.sync-waves"), applications())).toMatch(
      /^Its parent apps self-heals: .*Turn self-heal off on apps first\.$/,
    );
  });

  it("warns that the ApplicationSet generating it can put it back", () => {
    expect(rollbackRevertedBy(generated("guestbook"), applications())).toMatch(
      /^The ApplicationSet guestbooks generates guestbook/,
    );
  });

  it("does not warn for an Application nothing manages, or one whose sync is already off", () => {
    expect(rollbackRevertedBy(application("guestbook"), applications())).toBeUndefined();
    expect(rollbackRevertedBy(application("helm-guestbook"), applications())).toBeUndefined();
    expect(rollbackRevertedBy(generated("helm-guestbook"), applications())).toBeUndefined();
  });

  it("does not warn for a parent that does not self-heal", () => {
    const calm = variantOf("apps", (data) => {
      (data.spec.syncPolicy as Record<string, unknown>).automated = { prune: true };
    });
    const all = applications().map((each) => (each.getName() === "apps" ? calm : each));

    expect(rollbackRevertedBy(application("example.sync-waves"), all)).toBeUndefined();
  });

  it("ignores an owner of the same kind from another API group", () => {
    const foreign = variantOf("guestbook", (data) => {
      data.metadata.ownerReferences = [
        { apiVersion: "example.com/v1", kind: "ApplicationSet", name: "other", uid: "1" },
      ];
    });

    expect(rollbackRevertedBy(foreign, applications())).toBeUndefined();
  });

  it("says in the dialog what the rollback turns off, and who would undo it", () => {
    const guestbook = describeRollback(application("guestbook"), applications());

    expect(guestbook.detail).toMatch(/turns off its automated sync with self-heal/);
    expect(guestbook.detail).toMatch(/Resume auto-sync/);
    expect(guestbook.warning).toBeUndefined();
    expect(describeRollback(application("helm-guestbook"), applications()).detail).toMatch(
      /automated sync is off/,
    );
    expect(describeRollback(application("example.sync-waves"), applications()).warning).toMatch(
      /parent apps/,
    );
  });
});

describe("which syncs ask for the Application's name", () => {
  it("asks once prune or force is ticked, and not for a plain sync", () => {
    expect(isRiskyChoice({ prune: false, force: false })).toBe(false);
    expect(isRiskyChoice({ prune: false })).toBe(false);
    expect(isRiskyChoice({ prune: true, force: false })).toBe(true);
    expect(isRiskyChoice({ prune: false, force: true })).toBe(true);
  });
});

describe("the writes as sent, from the Application read just before", () => {
  const running = (phase: string) =>
    variantOf("guestbook", (data) => {
      (statusOf(data).operationState as Record<string, unknown>).phase = phase;
    });

  it("offers Terminate only while a sync runs", () => {
    expect(isSyncRunning(application("guestbook"))).toBe(false);
    expect(isSyncRunning(running("Running"))).toBe(true);
    expect(isSyncRunning(running("Terminating"))).toBe(false);
  });

  it("syncs with the version it read, and refuses a busy or vanished Application", () => {
    const read = application("guestbook");

    expect(planSync(read, "guestbook", { prune: true })).toEqual(
      withResourceVersion(syncPatch({ prune: true }), read.getResourceVersion()),
    );
    expect(() => planSync(running("Running"), "guestbook", { prune: false })).toThrow(
      operationRefusal(running("Running")),
    );
    expect(() => planSync(null, "guestbook", { prune: false })).toThrow(
      "guestbook no longer exists.",
    );
  });

  it("rolls back in one write that turns auto-sync off and says so", () => {
    const read = application("guestbook");
    const plan = planRollback(read, "guestbook", 21);
    const deploy = deployOf(read, 21);
    if (!deploy) throw new Error("guestbook has no deploy #21 in the fixtures");

    expect(plan.autoSyncOff).toBe(true);
    expect(plan.patch).toEqual(
      withResourceVersion(
        rollbackPatch(deploy, { autoSync: autoSyncOf(read) }),
        read.getResourceVersion(),
      ),
    );
    expect(plan.patch.spec?.syncPolicy.automated).toBeNull();
  });

  it("leaves auto-sync alone when it was already off", () => {
    const read = application("helm-guestbook");
    const [target] = rollbackTargetsOf(read, 1);
    if (!target) throw new Error("helm-guestbook has no earlier deploy in the fixtures");

    const plan = planRollback(read, "helm-guestbook", target.id);

    expect(plan.autoSyncOff).toBe(false);
    expect(plan.patch).not.toHaveProperty("spec");
    expect(plan.patch.metadata).toEqual({ resourceVersion: read.getResourceVersion() });
  });

  it("refuses a rollback before writing anything", () => {
    expect(() => planRollback(running("Running"), "guestbook", 21)).toThrow(
      "already has an operation running",
    );
    expect(() => planRollback(application("guestbook"), "guestbook", 999)).toThrow(
      "Deploy #999 of guestbook has no revision and source to go back to.",
    );
    expect(() => planRollback(undefined, "guestbook", 21)).toThrow("guestbook no longer exists.");
  });

  it("puts back only what a rollback from here turned off", () => {
    const rolledBack = variantOf("guestbook", (data) => {
      data.metadata.annotations = {
        ...(data.metadata.annotations as Record<string, string> | undefined),
        [AUTO_SYNC_BEFORE_ROLLBACK]: JSON.stringify({ selfHeal: true }),
      };
      (data.spec.syncPolicy as Record<string, unknown>).automated = null;
    });

    expect(planResumeAutoSync(rolledBack, "guestbook")).toEqual(
      withResourceVersion(resumeAutoSyncPatch({ selfHeal: true }), rolledBack.getResourceVersion()),
    );
    for (const current of [application("guestbook"), null]) {
      expect(() => planResumeAutoSync(current, "guestbook")).toThrow(
        "guestbook has no automated sync from a rollback to put back",
      );
    }
  });
});
