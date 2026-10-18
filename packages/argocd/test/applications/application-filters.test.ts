import { describe, expect, it } from "vitest";
import {
  countByStatus,
  filterApplications,
  governingProject,
  isStatusFilter,
  namedApplication,
  STATUS_FILTERS,
  STATUS_LABELS,
  type StatusFilter,
} from "../../src/renderer/api/applications/application-filters";
import { getCounts } from "../../src/renderer/api/overview/overview";
import { AppProject } from "../../src/renderer/api/projects/app-project";
import { applications, appProjects, projectVariantOf, variantOf } from "../support/fixtures";

const STATUSES = Object.keys(STATUS_FILTERS) as StatusFilter[];

// The same name in a second namespace, as apps-in-any-namespace allows.
const elsewhere = () =>
  variantOf("guestbook", (data) => {
    data.metadata.namespace = "team-apps";
  });

describe("the overview's cards and the list they open", () => {
  it("count exactly the rows the list shows on each card's filter", () => {
    const all = applications();
    const counts = getCounts(all, appProjects());

    for (const status of STATUSES) {
      expect(counts.byStatus[status], status).toBe(filterApplications(all, { status }).length);
    }
  });

  it("count Missing with Degraded, as the card says", () => {
    const counts = countByStatus(applications());

    expect(counts.outofsync).toBe(2);
    expect(counts.degraded).toBe(3);
    expect(counts.manual).toBe(1);
  });

  it("label every filter a card can name", () => {
    for (const status of STATUSES) expect(STATUS_LABELS[status]).toBeTruthy();
  });

  it("ignore a status no card names, rather than filtering everything away", () => {
    const all = applications();

    expect(isStatusFilter("constructor")).toBe(false);
    expect(isStatusFilter(undefined)).toBe(false);
    expect(filterApplications(all, { status: "toString" })).toHaveLength(all.length);
  });
});

describe("a link that names one Application", () => {
  it("shows only the one in the namespace it names, not its namesake", () => {
    const all = [...applications(), elsewhere()];
    const query = { name: "guestbook", namespace: "argocd" };

    expect(filterApplications(all, { name: "guestbook" })).toHaveLength(2);
    expect(filterApplications(all, query).map((each) => each.getNs())).toEqual(["argocd"]);
    expect(namedApplication(all, query)?.getNs()).toBe("argocd");
    expect(namedApplication(all, { name: "guestbook", namespace: "team-apps" })?.getNs()).toBe(
      "team-apps",
    );
  });

  it("opens no drawer for a name alone, or for one the list does not hold", () => {
    const all = applications();

    expect(namedApplication(all, { name: "guestbook" })).toBeUndefined();
    expect(namedApplication(all, { name: "guestbook", namespace: "demo" })).toBeUndefined();
  });

  it("combines the project with the status", () => {
    const rows = filterApplications(applications(), { project: "demo", status: "outofsync" });

    expect(rows.map((each) => each.getName()).sort()).toEqual(["bad-namespace", "helm-guestbook"]);
  });
});

describe("a project's link to its Applications", () => {
  // A second control plane with its own "demo", and one Application of each outside its project's namespaces.
  const secondDemo = () =>
    projectVariantOf("demo", (data) => {
      data.metadata.namespace = "argocd-b";
    });
  const inSecondPlane = () =>
    variantOf("podinfo", (data) => {
      data.metadata.namespace = "argocd-b";
    });

  it("lists as many rows as the count it was opened from", () => {
    const projects = [...appProjects(), secondDemo()];
    const all = [...applications(), elsewhere(), inSecondPlane()];
    const byProject = AppProject.groupApplicationsByProject(all);

    for (const project of projects) {
      const query = { project: project.getName(), projectNamespace: project.getNs() };
      const governing = governingProject(projects, query);

      expect(governing, project.getNs()).toBe(project);
      expect(
        filterApplications(all, query, governing),
        `${project.getNs()}/${project.getName()}`,
      ).toEqual(AppProject.governedIn(project, byProject));
    }
  });

  it("falls back to the name for a link without the project's namespace", () => {
    const projects = [...appProjects(), secondDemo()];

    expect(governingProject(projects, { project: "demo" })).toBeUndefined();
    expect(
      governingProject(projects, { project: "demo", projectNamespace: "elsewhere" }),
    ).toBeUndefined();
    expect(filterApplications(applications(), { project: "demo" }).length).toBeGreaterThan(0);
  });
});
