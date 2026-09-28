import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";
import { classifySource, getSourceExposure, shortenRepo } from "../src/renderer/api/sources";
import type { ApplicationSource } from "../src/renderer/api/types";
import { applications } from "./fixtures";

const source = (targetRevision: string, rest: Partial<ApplicationSource> = {}): ApplicationSource =>
  ({ repoURL: "https://github.com/org/repo.git", targetRevision, ...rest }) as ApplicationSource;

describe("classifying what a source follows", () => {
  it("calls a commit and a tag pinned", () => {
    expect(classifySource(source("0123456789abcdef0123456789abcdef01234567"))).toBe("pinned");
    expect(classifySource(source("v1.2.3"))).toBe("pinned");
    expect(classifySource(source("1.2"))).toBe("pinned");
  });

  it("calls a branch moving", () => {
    expect(classifySource(source("main"))).toBe("branch");
    expect(classifySource(source("master"))).toBe("branch");
    expect(classifySource(source("release/2026-09"))).toBe("branch");
  });

  it("calls a chart version range a range", () => {
    expect(classifySource(source("^1.2.0", { chart: "grafana" }))).toBe("range");
    expect(classifySource(source("1.2.*", { chart: "loki" }))).toBe("range");
    expect(classifySource(source(">=1.0 <2.0", { chart: "mimir" }))).toBe("range");
  });
});

describe("exposure across the real estate", () => {
  it("groups by repository and reference, not by path", () => {
    const exposure = getSourceExposure(applications());
    const references = exposure.moving.map(
      (group) => `${group.repoURL}@${group.targetRevision}${group.chart ?? ""}`,
    );

    expect(new Set(references).size).toBe(references.length);

    // Several directories of one repository at one branch are moved by the same
    // commit; splitting them per path would answer the wrong question.
    const widest = exposure.moving[0];

    expect(widest).toBeDefined();
    expect(widest?.applications.length).toBeGreaterThan(1);
  });

  it("counts each Application once per group even when it has several sources", () => {
    for (const group of getSourceExposure(applications()).moving) {
      const names = group.applications.map((candidate) => candidate.getName());

      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("counts an Application once when two of its sources share a reference", () => {
    const twice = new Application({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: {
        name: "twice",
        namespace: "argocd",
        uid: "twice",
        resourceVersion: "1",
        selfLink: "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/twice",
      },
      spec: {
        project: "default",
        destination: { server: "https://kubernetes.default.svc", namespace: "x" },
        sources: [
          { repoURL: "https://github.com/org/repo.git", path: "a", targetRevision: "main" },
          { repoURL: "https://github.com/org/repo.git", path: "b", targetRevision: "main" },
        ],
      },
    } as never);

    const exposure = getSourceExposure([twice]);

    expect(exposure.moving).toHaveLength(1);
    expect(exposure.moving[0]?.applications).toHaveLength(1);
    expect(exposure.exposed).toBe(1);
  });

  it("reports exposed as the number of Applications, not of source entries", () => {
    const all = applications();
    const exposure = getSourceExposure(all);

    expect(exposure.total).toBe(all.length);
    expect(exposure.exposed).toBeLessThanOrEqual(all.length);
    expect(exposure.exposed).toBeGreaterThan(0);
  });

  it("orders the groups by how many Applications one push would move", () => {
    const { moving } = getSourceExposure(applications());

    for (let index = 1; index < moving.length; index += 1) {
      expect(moving[index - 1]?.applications.length).toBeGreaterThanOrEqual(
        moving[index]?.applications.length ?? 0,
      );
    }
  });
});

describe("sources that are missing", () => {
  it("ignores a source with no repository at all", () => {
    const [candidate] = applications();

    expect(candidate).toBeDefined();

    const stripped = new Application(
      JSON.parse(
        JSON.stringify({
          ...(candidate as Application).toPlainObject(),
          spec: {
            ...(candidate as Application).spec,
            source: { targetRevision: "main" },
            sources: undefined,
          },
        }),
      ),
    );

    expect(getSourceExposure([stripped]).moving).toEqual([]);
    expect(getSourceExposure([stripped]).exposed).toBe(0);
  });

  it("treats an empty targetRevision as HEAD, which is what ArgoCD does", () => {
    expect(classifySource(source(""))).toBe("branch");
    expect(classifySource({ repoURL: "https://example.test/x" } as ApplicationSource)).toBe(
      "branch",
    );
  });

  it("returns an empty exposure for an empty cluster", () => {
    const exposure = getSourceExposure([]);

    expect(exposure).toEqual({ moving: [], pinned: 0, exposed: 0, total: 0 });
  });

  it("shortens repository URLs in both spellings and leaves a bare one alone", () => {
    expect(shortenRepo("git@github.com:org/repo.git")).toBe("org/repo");
    expect(shortenRepo("https://github.com/org/repo.git")).toBe("org/repo");
    expect(shortenRepo("https://gitlab.example.test/group/sub/repo")).toBe("group/sub/repo");
    expect(shortenRepo("org/repo")).toBe("org/repo");
  });

  it("keeps two charts from one repository apart, unlike two paths", () => {
    const app = (name: string, chart: string) =>
      new Application({
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name,
          namespace: "argocd",
          uid: name,
          resourceVersion: "1",
          selfLink: `/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/${name}`,
        },
        spec: {
          project: "default",
          destination: { server: "https://kubernetes.default.svc", namespace: "x" },
          source: { repoURL: "https://charts.example.test", chart, targetRevision: "^1.0.0" },
        },
      } as never);

    const exposure = getSourceExposure([app("a", "loki"), app("b", "mimir")]);

    expect(exposure.moving).toHaveLength(2);
    expect(exposure.moving.map((group) => group.chart).sort()).toEqual(["loki", "mimir"]);
  });

  it("labels an absent targetRevision as HEAD rather than as an empty string", () => {
    const headless = new Application({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: {
        name: "headless",
        namespace: "argocd",
        uid: "headless",
        resourceVersion: "1",
        selfLink: "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/headless",
      },
      spec: {
        project: "default",
        destination: { server: "https://kubernetes.default.svc", namespace: "x" },
        source: { repoURL: "https://github.com/org/repo.git", path: "." },
      },
    } as never);

    expect(getSourceExposure([headless]).moving[0]?.targetRevision).toBe("HEAD");
  });

  it("counts pinned sources separately from the moving ones", () => {
    const exposure = getSourceExposure(applications());

    expect(exposure.pinned).toBeGreaterThan(0);
  });

  it("does not read a case variation of a branch name as pinned", () => {
    expect(classifySource(source("MAIN"))).toBe("branch");
    expect(classifySource(source("HEAD"))).toBe("branch");
  });
});

describe("sources shaped in ways nobody writes on purpose", () => {
  it("does not read a chart version range as a branch name", () => {
    expect(classifySource(source("1.x", { chart: "loki" }))).toBe("range");
    expect(classifySource(source("~2", { chart: "loki" }))).toBe("range");
  });

  it("treats a targetRevision that is only whitespace as HEAD", () => {
    const blank = getSourceExposure([
      new Application({
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: {
          name: "blank",
          namespace: "argocd",
          uid: "blank",
          resourceVersion: "1",
          selfLink: "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/blank",
        },
        spec: {
          project: "default",
          destination: { server: "https://kubernetes.default.svc", namespace: "x" },
          source: { repoURL: "https://github.com/org/repo.git", targetRevision: "   " },
        },
      } as never),
    ]);

    expect(blank.moving[0]?.targetRevision).toBe("HEAD");
  });

  it("keeps a repository URL that shortens to nothing recognisable", () => {
    expect(shortenRepo("")).toBe("");
    expect(shortenRepo("https://github.com/")).toBe("");
  });
});
