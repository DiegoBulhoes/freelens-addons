import { describe, expect, it } from "vitest";

import { AppProject } from "../src/renderer/api/app-project";
import { Application } from "../src/renderer/api/application";
import { applications, appProjects, variantOf } from "./fixtures";

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

  it("names destinations the way ArgoCD displays them", () => {
    const project = projectFrom({
      destinations: [
        { server: "https://kubernetes.default.svc", namespace: "team-a" },
        { name: "staging", namespace: "*" },
      ],
    });

    expect(AppProject.getDestinations(project)).toEqual(["in-cluster/team-a", "staging/*"]);
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
    const wide = projectFrom({
      sourceRepos: ["*"],
      destinations: [{ server: "*", namespace: "*" }],
      clusterResourceWhitelist: [{ group: "*", kind: "*" }],
    });

    expect(AppProject.isUnrestricted(wide)).toBe(true);
  });
});

describe("an AppProject that restricts something", () => {
  it("is not unrestricted once a repository is named", () => {
    const scoped = projectFrom({
      sourceRepos: ["https://github.com/org/repo.git"],
      destinations: [{ server: "*", namespace: "*" }],
      clusterResourceWhitelist: [{ group: "*", kind: "*" }],
    });

    expect(AppProject.isUnrestricted(scoped)).toBe(false);
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
    const withRoles = projectFrom({ roles: [{ name: "read-only" }, { policies: [] }] });

    expect(AppProject.getRoles(withRoles)).toEqual(["read-only", "(unnamed)"]);
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
    expect(AppProject.selectApplications(projectFrom({}, "nobody"), applications())).toEqual([]);
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

    // A second entry means someone wrote something deliberate; "*" plus one
    // more is not the shape the default project ships with.
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
  /**
   * The filter as it was before the index, kept here as the oracle. If the two
   * disagree on any input the index is wrong, and the inputs that matter are
   * the names no Application carries: `getProject` has no fallback, so a
   * missing project is a real key in the map and was never equal to a name.
   */
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
