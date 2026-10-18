import { describe, expect, it } from "vitest";
import {
  applicationState,
  describeAutoSyncState,
  describeRoles,
  describeWindows,
  kindRules,
  knownCount,
  managerOf,
  projectLinkOf,
  projectState,
} from "../../src/renderer/api/applications/drawers";
import { AppProject } from "../../src/renderer/api/projects/app-project";
import { FREEZE_WINDOW } from "../../src/renderer/api/projects/freeze";
import { AUTO_SYNC_BEFORE_ROLLBACK } from "../../src/renderer/api/writes/patches";
import {
  application,
  applications,
  appProject,
  fixtureNow,
  projectVariantOf,
  variantOf,
} from "../support/fixtures";

describe("the Application drawer", () => {
  it("opens on the same finding the overview reports for it", () => {
    expect(applicationState(application("image-updates"), fixtureNow())).toMatchObject({
      tone: "critical",
      label: "Degraded",
    });
    expect(applicationState(application("bad-namespace"), fixtureNow())).toMatchObject({
      tone: "critical",
      label: "Missing",
    });
  });

  it("has no banner for an Application that needs nothing", () => {
    expect(applicationState(application("guestbook"), fixtureNow())).toBeUndefined();
  });

  it("falls back to the headline when the finding has no detail", () => {
    const quiet = variantOf("image-updates", (data) => {
      const status = data.status as { health: Record<string, unknown> };

      delete status.health.message;
    });

    expect(applicationState(quiet, fixtureNow())).toMatchObject({ reason: "Degraded" });
  });

  it("links its project where the host's drawer finds it", () => {
    expect(projectLinkOf(application("guestbook"))).toBe(appProject("demo").selfLink);
    expect(projectLinkOf(application("example.sync-waves"))).toBe(appProject("default").selfLink);
  });

  it("names the Application whose resources it is", () => {
    const apps = application("apps");

    expect(managerOf(application("example.sync-waves"), applications())).toEqual({
      kind: "Application",
      name: "apps",
      link: apps.selfLink,
    });
    expect(managerOf(application("guestbook"), applications())).toBeUndefined();
  });

  it("names the ApplicationSet that generates it, by the namespace its page opens it in", () => {
    expect(managerOf(application("guestbook-blue"), applications())).toEqual({
      kind: "ApplicationSet",
      name: "guestbooks",
      namespace: "argocd",
    });
  });

  it("names the ApplicationSet before any parent", () => {
    const generated = variantOf("example.sync-waves", (data) => {
      data.metadata.ownerReferences = [
        { apiVersion: "argoproj.io/v1alpha1", kind: "ApplicationSet", name: "waves", uid: "1" },
      ];
    });

    expect(managerOf(generated, applications())).toMatchObject({
      kind: "ApplicationSet",
      name: "waves",
    });
  });

  it("says how automated sync stands, including after a rollback from here", () => {
    expect(describeAutoSyncState(application("guestbook"))).toBe("on with self-heal");
    expect(describeAutoSyncState(application("apps"))).toBe("on with prune and self-heal");
    expect(describeAutoSyncState(application("helm-guestbook"))).toBe(
      "off: drift stays until someone syncs",
    );

    const rolledBack = variantOf("helm-guestbook", (data) => {
      data.metadata.annotations = { [AUTO_SYNC_BEFORE_ROLLBACK]: '{"selfHeal":true}' };
    });

    expect(describeAutoSyncState(rolledBack)).toMatch(
      /^off since a rollback from Freelens; .* automated sync with self-heal back$/,
    );
  });
});

describe("the project drawer", () => {
  const governed = (project: AppProject) =>
    AppProject.selectApplications(project, applications()).length;

  it("opens on a banner when deploys are frozen from here", () => {
    const frozen = projectVariantOf("demo", (data) => {
      data.spec.syncWindows = [FREEZE_WINDOW];
    });

    expect(projectState(frozen, governed(frozen))).toEqual({
      tone: "warning",
      label: "Deploys frozen",
      reason: `A deny sync window added from Freelens holds every sync of its ${governed(frozen)} Applications, automated and manual, until it is resumed.`,
    });
  });

  it("says how many windows decide when a project's Applications sync", () => {
    expect(projectState(appProject("restricted"), 0)).toEqual({
      tone: "info",
      label: "sync windows",
      reason: "2 sync windows decide when its 0 Applications may sync.",
    });
    expect(projectState(appProject("demo"), 1).reason).toBe(
      "No sync window: its 1 Application sync whenever ArgoCD needs to.",
    );
  });

  it("claims no count of Applications before their list is read", () => {
    for (const state of ["connecting", "unreachable", "not-installed"] as const) {
      expect(knownCount(state, 0), state).toBeUndefined();
    }
    expect(knownCount("ready", 0)).toBe(0);
    expect(projectState(appProject("demo"), undefined).reason).toBe(
      "No sync window: its Applications sync whenever ArgoCD needs to.",
    );
    expect(projectState(appProject("restricted"), undefined).reason).not.toMatch(/\d+ Application/);
  });

  it("lists every window in full, as the spec has them", () => {
    expect(describeWindows(appProject("restricted"))).toEqual([
      {
        key: "0/allow/0 22 * * *",
        kind: "allow",
        schedule: "0 22 * * * (UTC)",
        duration: "2h",
        appliesTo: "Applications *",
        manualSync: "allowed",
        description: "",
        fromFreelens: false,
      },
      {
        key: "1/deny/0 0 * * 6",
        kind: "deny",
        schedule: "0 0 * * 6 (UTC)",
        duration: "24h",
        appliesTo: "namespaces restricted",
        manualSync: "blocked",
        description: "Weekend freeze",
        fromFreelens: false,
      },
    ]);
    expect(describeWindows(appProject("demo"))).toEqual([]);
  });

  it("joins a window's selectors as ArgoCD does, and marks the one Freelens added", () => {
    const project = projectVariantOf("restricted", (data) => {
      data.spec.syncWindows = [
        {
          kind: "deny",
          schedule: "0 1 * * *",
          duration: "1h",
          timeZone: "Europe/Lisbon",
          applications: ["guestbook"],
          namespaces: ["restricted"],
          clusters: ["in-cluster"],
          andOperator: true,
        },
        { kind: "allow", schedule: "0 2 * * *", duration: "1h" },
        FREEZE_WINDOW,
      ];
    });
    const [joined, empty, frozen] = describeWindows(project);

    expect(joined?.schedule).toBe("0 1 * * * (Europe/Lisbon)");
    expect(joined?.appliesTo).toBe(
      "Applications guestbook and namespaces restricted and clusters in-cluster",
    );
    expect(empty?.appliesTo).toBe("nothing");
    expect(frozen).toMatchObject({ fromFreelens: true, appliesTo: "Applications *" });
  });

  it("lists the roles with their groups and how many policies each has", () => {
    expect(describeRoles(appProject("restricted"))).toEqual([
      {
        name: "read-only",
        description: "Read the project's Applications",
        groups: [],
        policies: 1,
      },
      {
        name: "deployer",
        description: "Sync the project's Applications",
        groups: ["restricted-deployers"],
        policies: 1,
      },
    ]);
    expect(describeRoles(appProject("demo"))).toEqual([]);
  });

  it("shows only the kind lists a project sets", () => {
    expect(kindRules(appProject("restricted"))).toEqual([
      { label: "Cluster kinds allowed", kinds: ["Namespace"] },
      { label: "Namespaced kinds denied", kinds: ["ResourceQuota"] },
    ]);
    expect(kindRules(appProject("demo"))).toEqual([
      { label: "Cluster kinds allowed", kinds: ["*/*"] },
    ]);
  });

  it("fills in what a sparse spec leaves out", () => {
    const sparse = projectVariantOf("restricted", (data) => {
      data.spec.syncWindows = [{}];
      data.spec.roles = [{}];
      data.spec.clusterResourceBlacklist = [{ group: "apps" }, {}];
    });

    expect(describeWindows(sparse)).toEqual([
      {
        key: "0/undefined/undefined",
        kind: "—",
        schedule: "— (UTC)",
        duration: "—",
        appliesTo: "nothing",
        manualSync: "blocked",
        description: "",
        fromFreelens: false,
      },
    ]);
    expect(describeRoles(sparse)).toEqual([
      { name: "(unnamed)", description: "", groups: [], policies: 0 },
    ]);
    expect(kindRules(sparse)).toContainEqual({
      label: "Cluster kinds denied",
      kinds: ["apps/*", "*"],
    });
  });

  it("links a project from an Application that names no control plane", () => {
    const loose = variantOf("guestbook", (data) => {
      delete data.metadata.namespace;
      delete (data.status as Record<string, unknown>).controllerNamespace;
    });

    expect(projectLinkOf(loose)).toBe(appProject("demo").selfLink);
  });
});
