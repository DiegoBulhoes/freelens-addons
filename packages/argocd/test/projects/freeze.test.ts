import { describe, expect, it } from "vitest";
import { AppProject } from "../../src/renderer/api/projects/app-project";
import {
  FREEZE_DESCRIPTION,
  FREEZE_WINDOW,
  frozenProjectOf,
  frozenWindows,
  isFrozen,
  syncWindowsPatch,
  thawedWindows,
  windowsFor,
} from "../../src/renderer/api/projects/freeze";
import type { SyncWindow } from "../../src/renderer/api/shared/types";
import {
  application,
  appProject,
  appProjects,
  projectVariantOf,
  variantOf,
} from "../support/fixtures";

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
    const project = appProject("restricted");

    expect(AppProject.getSyncWindows(project).some((window) => window.kind === "deny")).toBe(true);
    expect(isFrozen(project)).toBe(false);

    const marked = frozenWindows([]);

    expect(marked[0]?.description).toBe(FREEZE_DESCRIPTION);
    expect(thawedWindows([{ ...handWritten, description: "Frozen elsewhere" }])).toHaveLength(1);
  });
});

describe("freezing and resuming as each other's undo", () => {
  it("freezes and resumes from whatever the project holds now", () => {
    const project = appProjects()[0];
    if (!project) throw new Error("no AppProject in the fixtures");

    const existing = AppProject.getSyncWindows(project);
    const frozen = windowsFor(existing, true);

    expect(frozen).toEqual([...existing, FREEZE_WINDOW]);
    expect(windowsFor(frozen, false)).toEqual(existing);
    expect(windowsFor(frozen, true)).toBe(frozen);
  });

  it("removes the list when resuming leaves no window, as a project without one has none", () => {
    const project = appProject("demo");
    const frozen = projectVariantOf("demo", (data) => {
      data.spec.syncWindows = frozenWindows([]);
    });

    expect(project.spec.syncWindows).toBeUndefined();
    expect(syncWindowsPatch(frozen, false)?.spec).toEqual({ syncWindows: null });
    expect(syncWindowsPatch(project, true)?.spec).toEqual({ syncWindows: [FREEZE_WINDOW] });
  });

  it("sends the version it read, so a window added meanwhile turns the write into a 409", () => {
    const project = appProject("restricted");
    const patch = syncWindowsPatch(project, true);

    expect(patch).toEqual({
      spec: { syncWindows: [...AppProject.getSyncWindows(project), FREEZE_WINDOW] },
      metadata: { resourceVersion: project.getResourceVersion() },
    });
    expect(project.getResourceVersion()).toBeTruthy();
    const frozen = projectVariantOf("restricted", (data) => {
      data.spec.syncWindows = [...AppProject.getSyncWindows(project), FREEZE_WINDOW];
    });

    expect(syncWindowsPatch(frozen, true)).toBeUndefined();
  });
});

describe("a sync held by a frozen project", () => {
  it("names the project when its own freeze window is in it, and nothing otherwise", () => {
    const app = application("helm-guestbook");
    const frozen = projectVariantOf("demo", (data) => {
      data.spec.syncWindows = frozenWindows([]);
    });

    expect(frozenProjectOf(app, [frozen])).toBe("demo");
    expect(frozenProjectOf(app, appProjects())).toBeUndefined();
    expect(frozenProjectOf(app, [])).toBeUndefined();
  });
});

describe("a sync held by a frozen project, across namespaces", () => {
  const frozenDemo = (sourceNamespaces?: string[]) =>
    projectVariantOf("demo", (data) => {
      data.spec.syncWindows = frozenWindows([]);
      if (sourceNamespaces) data.spec.sourceNamespaces = sourceNamespaces;
    });
  const inNamespace = (namespace: string) =>
    variantOf("helm-guestbook", (data) => {
      data.metadata.namespace = namespace;
    });

  it("warns for an Application outside the control plane that the project admits", () => {
    expect(frozenProjectOf(inNamespace("team-apps"), [frozenDemo(["team-*"])])).toBe("demo");
  });

  it("ignores a project of the same name that does not admit the Application's namespace", () => {
    expect(frozenProjectOf(inNamespace("team-apps"), [frozenDemo()])).toBeUndefined();
  });

  it("ignores a frozen project of the same name in another control plane", () => {
    const otherInstance = projectVariantOf("demo", (data) => {
      data.spec.syncWindows = frozenWindows([]);
      data.metadata.namespace = "argocd-b";
    });

    expect(frozenProjectOf(application("helm-guestbook"), [otherInstance])).toBeUndefined();
  });
});
