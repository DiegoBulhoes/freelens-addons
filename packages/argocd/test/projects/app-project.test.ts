import { describe, expect, it } from "vitest";
import { Application } from "../../src/renderer/api/applications/application";
import { AppProject, namespaceMatches } from "../../src/renderer/api/projects/app-project";
import {
  application,
  applications,
  appProject,
  appProjects,
  projectVariantOf,
  variantOf,
} from "../support/fixtures";

function projectFrom(spec: Record<string, unknown>, name = "team-a"): AppProject {
  return new AppProject({
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
    metadata: {
      name,
      namespace: "argocd",
      uid: `argocd/${name}`,
      resourceVersion: "1",
      selfLink: `/apis/argoproj.io/v1alpha1/namespaces/argocd/appprojects/${name}`,
    },
    spec,
  } as never);
}

describe("an AppProject's guardrails, as the cluster has them", () => {
  it("reads the project the fixtures contain", () => {
    const [project] = appProjects();

    expect(project).toBeDefined();
    expect(project?.getName()).toBeTruthy();
    expect(AppProject.getSourceRepos(project as AppProject).length).toBeGreaterThan(0);
  });

  it("selects the Applications assigned to it and no others", () => {
    const [project] = appProjects();
    const all = applications();
    const selected = AppProject.selectApplications(project as AppProject, all);

    expect(selected.length).toBeGreaterThan(0);

    for (const candidate of selected) {
      expect(Application.getProject(candidate)).toBe(project?.getName());
    }
  });

  it("names destinations the way ArgoCD displays them, by server or by name", () => {
    expect(AppProject.getDestinations(appProject("restricted"))).toEqual([
      "in-cluster/restricted",
      "in-cluster/restricted-*",
    ]);
  });

  it("names a remote destination cluster by host", () => {
    const remote = projectFrom({
      destinations: [{ server: "https://k8s.example.test:6443", namespace: "edge" }],
    });

    expect(AppProject.getDestinations(remote)).toEqual(["k8s.example.test:6443/edge"]);
  });

  it("falls back to a wildcard cluster when a destination names no server at all", () => {
    const anonymous = projectFrom({ destinations: [{ server: "", namespace: "edge" }] });

    expect(AppProject.getDestinations(anonymous)).toEqual(["*/edge"]);
  });

  it("recognises a project that restricts nothing", () => {
    expect(AppProject.isUnrestricted(appProject("demo"))).toBe(true);
  });
});

describe("an AppProject that restricts something", () => {
  it("is not unrestricted once a repository is named", () => {
    const scoped = projectVariantOf("demo", (data) => {
      data.spec.sourceRepos = AppProject.getSourceRepos(appProject("restricted"));
    });

    expect(AppProject.isUnrestricted(scoped)).toBe(false);
    expect(AppProject.isUnrestricted(appProject("restricted"))).toBe(false);
  });

  it("is not unrestricted when a blacklist is present", () => {
    const guarded = projectFrom({
      sourceRepos: ["*"],
      destinations: [{ server: "*", namespace: "*" }],
      clusterResourceWhitelist: [{ group: "*", kind: "*" }],
      clusterResourceBlacklist: [{ group: "", kind: "Secret" }],
    });

    expect(AppProject.isUnrestricted(guarded)).toBe(false);
  });

  it("is not unrestricted when the cluster whitelist names specific kinds", () => {
    const narrow = projectFrom({
      sourceRepos: ["*"],
      destinations: [{ server: "*", namespace: "*" }],
      clusterResourceWhitelist: [{ group: "", kind: "Namespace" }],
    });

    expect(AppProject.isUnrestricted(narrow)).toBe(false);
  });

  it("lists the roles it defines, naming an unnamed one rather than dropping it", () => {
    expect(AppProject.getRoles(appProject("restricted"))).toEqual(["read-only", "deployer"]);

    const unnamed = projectVariantOf("restricted", (data) => {
      (data.spec.roles as unknown[]).push({ policies: [] });
    });

    expect(AppProject.getRoles(unnamed)).toEqual(["read-only", "deployer", "(unnamed)"]);
  });

  it("reads its sync windows as written", () => {
    expect(
      AppProject.getSyncWindows(appProject("restricted")).map((window) => window.kind),
    ).toEqual(["allow", "deny"]);
  });
});

describe("an AppProject with nothing filled in", () => {
  it("returns empty lists rather than undefined for every constraint", () => {
    const bare = projectFrom({});

    expect(AppProject.getSourceRepos(bare)).toEqual([]);
    expect(AppProject.getDestinations(bare)).toEqual([]);
    expect(AppProject.getRoles(bare)).toEqual([]);
    expect(AppProject.getSyncWindows(bare)).toEqual([]);
    expect(AppProject.getDescription(bare)).toBeUndefined();
  });

  it("is not unrestricted when it simply says nothing — an absent list is not a wildcard", () => {
    expect(AppProject.isUnrestricted(projectFrom({}))).toBe(false);
  });

  it("falls back to a wildcard cluster for a destination naming only a namespace", () => {
    const partial = projectFrom({ destinations: [{ namespace: "team-a" }] });

    expect(AppProject.getDestinations(partial)).toEqual(["*/team-a"]);
  });

  it("selects nothing out of an empty Application list", () => {
    expect(AppProject.selectApplications(projectFrom({}), [])).toEqual([]);
  });

  it("selects nothing when no Application names it", () => {
    expect(AppProject.selectApplications(appProject("restricted"), applications())).toEqual([]);
  });
});

describe("an AppProject whose spec makes no sense", () => {
  it("does not crash on a destination that is an empty object", () => {
    expect(AppProject.getDestinations(projectFrom({ destinations: [{}] }))).toEqual(["*/*"]);
  });

  it("does not treat two wildcards as unrestricted when the lists are longer", () => {
    const twoRepos = projectFrom({
      sourceRepos: ["*", "https://github.com/org/repo.git"],
      destinations: [{ server: "*", namespace: "*" }],
      clusterResourceWhitelist: [{ group: "*", kind: "*" }],
    });

    expect(AppProject.isUnrestricted(twoRepos)).toBe(false);
  });

  it("selects nothing for a project whose name no Application could carry", () => {
    expect(AppProject.selectApplications(projectFrom({}, ""), applications())).toEqual([]);
  });

  it("reads a sync window list that is present but empty", () => {
    expect(AppProject.getSyncWindows(projectFrom({ syncWindows: [] }))).toEqual([]);
  });
});

describe("the project index against the filter it replaces", () => {
  /** The linear filter, kept as the oracle for the index. */
  function filterForProject(object: AppProject, all: Application[]): Application[] {
    const name = object.getName();

    return all.filter((application) => Application.getProject(application) === name);
  }

  it("agrees with the filter for every project in the cluster", () => {
    const all = applications();

    for (const project of appProjects()) {
      expect(AppProject.selectApplications(project, all)).toEqual(filterForProject(project, all));
    }
  });

  it("loses no Application and duplicates none", () => {
    const all = applications();
    const grouped = AppProject.groupApplicationsByProject(all);
    const seen = [...grouped.values()].flat();

    expect(seen).toHaveLength(all.length);
    expect(new Set(seen).size).toBe(all.length);
  });

  it("keys every group by the project its members name", () => {
    for (const [project, group] of AppProject.groupApplicationsByProject(applications())) {
      for (const application of group) {
        expect(Application.getProject(application)).toBe(project);
      }
    }
  });

  it("asks nothing of the fleet when there are no Applications", () => {
    expect(AppProject.groupApplicationsByProject([]).size).toBe(0);
  });
});

describe("the project index on projects the cluster has not produced", () => {
  const inProject = (name: string, project: unknown) =>
    variantOf("guestbook", (data) => {
      data.metadata.name = name;
      data.metadata.uid = `argocd/${name}`;
      data.metadata.selfLink = `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${name}`;

      if (project === undefined) delete data.spec.project;
      else data.spec.project = project;
    });

  it("keeps Applications of different projects apart", () => {
    const grouped = AppProject.groupApplicationsByProject([
      inProject("one", "team-a"),
      inProject("two", "team-b"),
      inProject("three", "team-a"),
    ]);

    expect(grouped.size).toBe(2);
    expect(grouped.get("team-a")?.map((each) => each.getName())).toEqual(["one", "three"]);
    expect(grouped.get("team-b")?.map((each) => each.getName())).toEqual(["two"]);
  });

  it("puts an Application with no project in no real project's group", () => {
    const orphan = inProject("orphan", undefined);
    const named = inProject("named", "team-a");
    const grouped = AppProject.groupApplicationsByProject([orphan, named]);

    expect(grouped.get("team-a")).toEqual([named]);
    expect(grouped.get("")).toBeUndefined();
    expect(AppProject.selectApplications(projectFrom({}, "team-a"), [orphan, named])).toEqual([
      named,
    ]);
  });

  it("does not match an empty project name by truthiness", () => {
    const named = inProject("named", "team-a");

    expect(AppProject.selectApplications(projectFrom({}, ""), [named])).toEqual([]);
  });
});

describe("which Applications a project governs", () => {
  const demo = (sourceNamespaces?: string[], namespace?: string) =>
    projectVariantOf("demo", (data) => {
      if (sourceNamespaces) data.spec.sourceNamespaces = sourceNamespaces;
      if (namespace) data.metadata.namespace = namespace;
    });
  const inNamespace = (namespace: string | undefined) =>
    variantOf("guestbook", (data) => {
      if (namespace === undefined) delete data.metadata.namespace;
      else data.metadata.namespace = namespace;
    });

  it("governs its Applications in its own namespace", () => {
    expect(AppProject.governs(demo(), application("guestbook"))).toBe(true);
    expect(AppProject.governs(demo(), application("example.sync-waves"))).toBe(false);
  });

  it("does not govern another control plane's Applications that name a project like it", () => {
    const otherInstance = demo(undefined, "argocd-b");

    expect(AppProject.governs(otherInstance, application("guestbook"))).toBe(false);
    expect(AppProject.selectApplications(otherInstance, applications())).toEqual([]);
  });

  it("governs Applications in namespaces its sourceNamespaces match, by glob or /regex/", () => {
    const outside = inNamespace("team-apps");

    expect(AppProject.governs(demo(), outside)).toBe(false);
    expect(AppProject.governs(demo(["team-*"]), outside)).toBe(true);
    expect(AppProject.governs(demo(["/^team-/"]), outside)).toBe(true);
    expect(AppProject.governs(demo(["other", "/^qa-/"]), outside)).toBe(false);
  });

  it("counts the admitted Applications among its own, and only those", () => {
    const outside = inNamespace("team-apps");
    const all = [...applications(), outside];
    const own = AppProject.selectApplications(demo(), all);

    expect(own.length).toBeGreaterThan(0);
    expect(own).not.toContain(outside);
    expect(AppProject.selectApplications(demo(["team-*"]), all)).toEqual([...own, outside]);
    expect(
      AppProject.governedIn(demo(["team-*"]), AppProject.groupApplicationsByProject(all)),
    ).toEqual([...own, outside]);
  });

  it("governs nothing without a namespace, and matches nothing with a broken pattern", () => {
    expect(AppProject.governs(demo(["*"]), inNamespace(undefined))).toBe(false);
    expect(namespaceMatches("/(/", "team-apps")).toBe(false);
    expect(namespaceMatches("/", "/")).toBe(true);
  });
});
