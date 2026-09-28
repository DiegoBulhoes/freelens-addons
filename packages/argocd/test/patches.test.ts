import { describe, expect, it } from "vitest";
import { AppProject } from "../src/renderer/api/app-project";
import {
  disableAutoSyncPatch,
  FREEZE_DESCRIPTION,
  FREEZE_WINDOW,
  frozenWindows,
  isFrozen,
  REFRESH_ANNOTATION,
  refreshPatch,
  revisionOfHistory,
  rollbackPatch,
  syncPatch,
  terminatePatch,
  thawedWindows,
} from "../src/renderer/api/patches";
import type { SyncWindow } from "../src/renderer/api/types";
import { application, appProjects, statusOf, variantOf } from "./fixtures";

/**
 * These are the only bodies this extension writes into a cluster, which makes
 * them the only place a mistake reaches production. Every assertion here is
 * about the exact shape ArgoCD's controller reads.
 */

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
    // Pinning would re-apply whatever was last synced, which is not what
    // "sync" means to the person clicking it.
    expect(patch.operation.sync).not.toHaveProperty("revision");
    expect(patch.operation.initiatedBy).toEqual({ username: "freelens" });
  });

  it("carries prune through only when it was asked for", () => {
    expect(syncPatch({ prune: true }).operation.sync.prune).toBe(true);
    expect(syncPatch({ prune: false }).operation.sync.prune).toBe(false);
  });

  it("terminates by clearing the operation, not by writing a phase", () => {
    expect(terminatePatch()).toEqual({ operation: null });
  });

  it("turns automated sync off with an explicit null", () => {
    // `undefined` would be dropped from the JSON and the patch would do
    // nothing at all; null is what removes the field.
    expect(disableAutoSyncPatch().spec.syncPolicy.automated).toBeNull();
  });

  it("records why a rollback happened where ArgoCD shows it", () => {
    const patch = rollbackPatch("abc1234", 42);

    expect(patch.operation.sync.revision).toBe("abc1234");
    expect(patch.operation.info).toEqual([{ name: "Reason", value: "Rollback to deploy #42" }]);
  });
});

describe("patches — when the history does not say what it should", () => {
  it("returns no revision for a history id that is not there", () => {
    expect(revisionOfHistory(application("podinfo"), 999_999)).toBeUndefined();
  });

  it("reads the singular revision a single-source Application records", () => {
    const single = variantOf("podinfo", (data) => {
      statusOf(data).history = [{ id: 7, revision: "deadbee" }];
    });

    expect(revisionOfHistory(single, 7)).toBe("deadbee");
  });

  it("reads the first of the revisions a multi-source Application records", () => {
    const multi = variantOf("podinfo", (data) => {
      statusOf(data).history = [{ id: 8, revisions: ["cafe123", "v2.0.0"] }];
    });

    expect(revisionOfHistory(multi, 8)).toBe("cafe123");
  });

  it("returns no revision when the Application has no history at all", () => {
    const empty = variantOf("podinfo", (data) => {
      delete data.status;
    });

    expect(revisionOfHistory(empty, 1)).toBeUndefined();
  });

  it("still produces a rollback patch when the revision is unknown", () => {
    // ArgoCD then syncs to the source's declared revision; an absent field is
    // better than the string "undefined".
    expect(rollbackPatch(undefined, 3).operation.sync.revision).toBeUndefined();
  });
});

describe("freezing — the sync windows a freeze produces", () => {
  const handWritten: SyncWindow = {
    kind: "allow",
    schedule: "0 9 * * 1-5",
    duration: "8h",
    description: "business hours",
  };

  it("adds a deny window that cannot be synced through by hand", () => {
    const windows = frozenWindows([]);

    expect(windows).toEqual([FREEZE_WINDOW]);
    expect(windows[0]?.kind).toBe("deny");
    expect(windows[0]?.manualSync).toBe(false);
    expect(windows[0]?.applications).toEqual(["*"]);
  });

  it("is idempotent — freezing twice does not stack windows", () => {
    const once = frozenWindows([]);

    expect(frozenWindows(once)).toBe(once);
    expect(frozenWindows(once)).toHaveLength(1);
  });

  it("leaves a hand-written window alone when freezing and when thawing", () => {
    const frozen = frozenWindows([handWritten]);

    expect(frozen).toHaveLength(2);
    expect(thawedWindows(frozen)).toEqual([handWritten]);
  });

  it("thawing something never frozen changes nothing", () => {
    expect(thawedWindows([handWritten])).toEqual([handWritten]);
    expect(thawedWindows([])).toEqual([]);
  });

  it("recognises a project it has already frozen", () => {
    const frozen = new AppProject({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "AppProject",
      metadata: {
        name: "frozen",
        namespace: "argocd",
        uid: "argocd/frozen",
        resourceVersion: "1",
        selfLink: "/apis/argoproj.io/v1alpha1/namespaces/argocd/appprojects/frozen",
      },
      spec: { syncWindows: frozenWindows([handWritten]) },
    } as never);

    expect(isFrozen(frozen)).toBe(true);
  });

  it("recognises its own window on a real AppProject and not a foreign one", () => {
    const project = appProjects()[0];

    expect(project).toBeDefined();
    expect(isFrozen(project as NonNullable<typeof project>)).toBe(false);

    const marked = frozenWindows([]);

    expect(marked[0]?.description).toBe(FREEZE_DESCRIPTION);
    expect(thawedWindows([{ ...handWritten, description: "Frozen elsewhere" }])).toHaveLength(1);
  });
});
