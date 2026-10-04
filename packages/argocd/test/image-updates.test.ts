import { describe, expect, it } from "vitest";

import { ImageUpdater } from "../src/renderer/api/image-updater";
import {
  countWatching,
  DEFAULT_INTERVAL_MS,
  describeRulesHeadline,
  describeRulesState,
  describeWriteBack,
  formatAge,
  globMatches,
  imagesForApplication,
  labelsMatch,
  needingAttention,
  rankRules,
  recentUpdates,
  restartRefusal,
  ruleHealth,
  runningTag,
  selectApplications,
  specificity,
  splitImage,
  trackedImages,
  unsupportedReason,
} from "../src/renderer/api/image-updates";
import { application, applications, imageUpdater, imageUpdaters } from "./fixtures";

// Fixtures are the rules `dev/cluster/components/argocd/image-updater.yaml` seeds, as the controller left them.

/** The newest check in the fixtures, used as `now`. */
function checkedNow(): number {
  return Math.max(
    ...imageUpdaters().map((updater) => Date.parse(updater.status?.lastCheckedAt ?? "")),
  );
}

describe("which Applications a rule reaches", () => {
  it.each([
    ["image-updates", "image-updates", true],
    ["legacy-*", "legacy-annotations", true],
    ["legacy-*", "legacy", false],
    ["image-?pdates", "image-updates", true],
    ["[a-h]*", "guestbook", true],
    ["[^a-h]*", "guestbook", false],
    ["\\*", "*", true],
    ["\\*", "a", false],
    ["*", "team/app", false],
  ])("reads %s against %s as Go's filepath.Match does", (pattern, name, expected) => {
    expect(globMatches(pattern, name)).toBe(expected);
  });

  it("matches nothing with a pattern Go would reject", () => {
    expect(globMatches("image-updates-[", "image-updates-a")).toBe(false);
    expect(globMatches("trailing\\", "trailing")).toBe(false);
  });

  it("applies every part of a label selector", () => {
    const labels = { team: "web", tier: "front" };

    expect(labelsMatch(labels)).toBe(true);
    expect(labelsMatch(labels, { matchLabels: { team: "web" } })).toBe(true);
    expect(labelsMatch(labels, { matchLabels: { team: "api" } })).toBe(false);
    expect(
      labelsMatch(labels, {
        matchExpressions: [{ key: "tier", operator: "In", values: ["front"] }],
      }),
    ).toBe(true);
    expect(
      labelsMatch(labels, {
        matchExpressions: [{ key: "tier", operator: "In", values: ["back"] }],
      }),
    ).toBe(false);
    expect(
      labelsMatch(labels, {
        matchExpressions: [{ key: "tier", operator: "NotIn", values: ["front"] }],
      }),
    ).toBe(false);
    expect(labelsMatch(labels, { matchExpressions: [{ key: "env", operator: "Exists" }] })).toBe(
      false,
    );
    expect(
      labelsMatch(labels, { matchExpressions: [{ key: "team", operator: "DoesNotExist" }] }),
    ).toBe(false);
  });

  it("ranks an exact name above any pattern, and a selector above a longer pattern", () => {
    expect(specificity({ namePattern: "image-updates" })).toBeGreaterThan(
      specificity({ namePattern: "image-updates-*-with-a-long-tail" }),
    );
    expect(
      specificity({ namePattern: "a*", labelSelectors: { matchLabels: { team: "web" } } }),
    ).toBeGreaterThan(specificity({ namePattern: "a-much-longer-pattern-*" }));
    expect(
      specificity({
        namePattern: "*",
        labelSelectors: { matchExpressions: [{ key: "a", operator: "Exists" }] },
      }),
    ).toBeGreaterThan(specificity({ namePattern: "*", labelSelectors: {} }));
  });

  it("finds the Application podinfo-patches names, and only in its own namespace", () => {
    const selected = selectApplications(imageUpdater("podinfo-patches"), applications());

    expect(selected.map((selection) => selection.application.getName())).toEqual(["image-updates"]);
    expect(selected[0]?.skipped).toBeUndefined();
  });

  it("gives the Application to the most specific of several references", () => {
    const updater = imageUpdater("podinfo-patches");
    const broad = { namePattern: "*" };
    const exact = updater.spec.applicationRefs?.[0];
    const both = new ImageUpdater({
      ...updater,
      spec: { applicationRefs: [broad, exact as NonNullable<typeof exact>] },
    } as never);

    const selected = selectApplications(both, [application("image-updates")]);

    expect(selected[0]?.ref.namePattern).toBe("image-updates");
  });

  it("says why the controller skips a plain directory, and not a Helm or Kustomize one", () => {
    expect(unsupportedReason(application("guestbook-pinned"))).toMatch(/directory source/);
    expect(unsupportedReason(application("helm-guestbook"))).toBeUndefined();
    expect(unsupportedReason(application("image-updates"))).toBeUndefined();
  });

  it("lets a git write-back target make a plain directory updatable", () => {
    expect(
      unsupportedReason(application("guestbook-pinned"), {
        method: "git",
        gitConfig: { writeBackTarget: "kustomization:../base" },
      }),
    ).toBeUndefined();
  });

  it("cannot judge an Application ArgoCD has not typed yet, and says so", () => {
    const untyped = application("image-updates");
    delete untyped.status?.sourceType;

    expect(unsupportedReason(untyped)).toMatch(/not reported its source type/);
  });

  it("reads the type of a multi-source Application from its list of types", () => {
    const podinfo = application("podinfo");

    expect(podinfo.status?.sourceTypes?.length).toBeGreaterThan(1);
    expect(unsupportedReason(podinfo)).toBeUndefined();
  });
});

describe("the health of each rule, against the cluster as it was", () => {
  const ranked = rankRules(imageUpdaters(), applications(), checkedNow());
  const stateOf = (name: string) => ranked.find((row) => row.updater.getName() === name)?.health;

  it("puts the rule the controller refused first, with its own words", () => {
    expect(ranked[0]?.updater.getName()).toBe("bad-pattern");
    expect(ranked[0]?.health.state).toBe("failing");
    expect(ranked[0]?.health.reason).toContain("invalid application name pattern");
    expect(ranked[0]?.health.reason).toMatch(/cannot start/);
  });

  it("calls out failing checks behind Ready=True", () => {
    const health = stateOf("frontend-private");

    expect(ImageUpdater.getCondition(imageUpdater("frontend-private"), "Ready")?.status).toBe(
      "True",
    );
    expect(health?.state).toBe("errors");
    expect(health?.tone).toBe("critical");
    expect(health?.reason).toMatch(/Ready still says True/);
  });

  it("tells a pattern that names nothing from one that names what will be skipped", () => {
    expect(stateOf("retired")?.state).toBe("matches-nothing");
    expect(stateOf("retired")?.reason).toContain("retired-*");
    expect(stateOf("plain-manifests")?.state).toBe("skipped");
    expect(stateOf("plain-manifests")?.reason).toMatch(/guestbook-pinned.*directory source/);
  });

  it("calls the working rules fine, and says when they last updated", () => {
    expect(stateOf("podinfo-patches")?.state).toBe("ok");
    expect(stateOf("podinfo-patches")?.reason).toMatch(/Last updated an image/);
    expect(stateOf("from-annotations")?.state).toBe("ok");
    expect(stateOf("from-annotations")?.reason).toMatch(/Nothing newer/);
  });

  it("orders worst first and keeps every rule", () => {
    expect(ranked.map((row) => row.health.state)).toEqual([
      "failing",
      "errors",
      "skipped",
      "matches-nothing",
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("calls a rule stale once the controller has missed several checks", () => {
    const later = checkedNow() + 6 * DEFAULT_INTERVAL_MS;
    const health = ruleHealth(imageUpdater("podinfo-patches"), applications(), later);

    expect(health.state).toBe("stale");
    expect(health.reason).toMatch(/every 2m by default/);
    expect(
      ruleHealth(imageUpdater("podinfo-patches"), applications(), checkedNow() + 4 * 60_000, 30_000)
        .state,
    ).toBe("stale");
  });

  it("waits for a rule the controller has not looked at yet, then stops waiting", () => {
    const fresh = imageUpdater("podinfo-patches");
    delete (fresh as { status?: unknown }).status;
    const created = Date.parse(fresh.metadata.creationTimestamp ?? "");

    expect(ruleHealth(fresh, applications(), created + 30_000).state).toBe("waiting");
    expect(ruleHealth(fresh, applications(), created + 60 * 60_000).state).toBe("never-checked");
  });

  it("formats ages the way the rest of the page does", () => {
    expect(formatAge(-5)).toBe("0s");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(12 * 60_000)).toBe("12m");
    expect(formatAge(5 * 3_600_000)).toBe("5h");
    expect(formatAge(3 * 86_400_000)).toBe("3d");
  });
});

describe("the images each rule watches", () => {
  const rows = trackedImages(imageUpdaters(), applications());
  const rowOf = (updater: string) => rows.find((row) => row.updater === updater);

  it("shows podinfo's constraint, strategy, destination and what runs now", () => {
    expect(rowOf("podinfo-patches")).toMatchObject({
      alias: "podinfo",
      repository: "ghcr.io/stefanprodan/podinfo",
      constraint: "6.14.x",
      strategy: "semver",
      writeBack: "the Application, in the cluster",
      fromAnnotations: false,
      applications: [{ name: "image-updates", running: "6.14.1" }],
    });
  });

  it("merges the layers, the image's own winning", () => {
    expect(rowOf("frontend-private")).toMatchObject({
      strategy: "newest-build",
      constraint: undefined,
      applications: [{ name: "helm-guestbook", running: "v5" }],
    });
  });

  it("keeps a rule's image with no Applications, and marks a skipped one", () => {
    expect(rowOf("retired")?.applications).toEqual([]);
    expect(rowOf("plain-manifests")?.applications[0]).toMatchObject({
      name: "guestbook-pinned",
      skipped: expect.stringMatching(/directory source/),
    });
  });

  it("reads the image list from the Application when the rule says to", () => {
    expect(rowOf("from-annotations")).toMatchObject({
      alias: "podinfo",
      constraint: "6.13.x",
      strategy: "semver",
      fromAnnotations: true,
      applications: [{ name: "legacy-annotations", running: "6.13.0" }],
    });
  });

  it("lists, for one Application, only the rules that reach it", () => {
    expect(
      imagesForApplication(application("image-updates"), imageUpdaters()).map((row) => row.updater),
    ).toEqual(["podinfo-patches"]);
    expect(imagesForApplication(application("guestbook"), imageUpdaters())).toEqual([]);
  });

  it("separates a registry's port from a tag, and drops a digest", () => {
    expect(splitImage("registry.local:5000/team/app")).toEqual({
      repository: "registry.local:5000/team/app",
    });
    expect(splitImage("registry.local:5000/team/app:1.x")).toEqual({
      repository: "registry.local:5000/team/app",
      tag: "1.x",
    });
    expect(splitImage("nginx@sha256:abc")).toEqual({ repository: "nginx" });
  });

  it("finds a Docker Hub image however it is spelled, and nothing it does not run", () => {
    const running = application("image-updates");
    running.status = {
      ...running.status,
      summary: { images: ["docker.io/library/nginx:1.27", "busybox"] },
    };

    expect(runningTag(running, "nginx")).toBe("1.27");
    expect(runningTag(running, "index.docker.io/library/busybox")).toBe("latest");
    expect(runningTag(running, "ghcr.io/stefanprodan/podinfo")).toBeUndefined();
  });

  it("names a git destination by repository and branch", () => {
    expect(
      describeWriteBack({
        method: "git",
        gitConfig: { repository: "git@example.test:team/deploy.git", branch: "main" },
      }),
    ).toBe("a commit to git@example.test:team/deploy.git, branch main");
    expect(describeWriteBack({ method: "git:secret:argocd/creds" })).toBe(
      "a commit to the Application's repository",
    );
    expect(describeWriteBack({})).toBe("the Application, in the cluster");
  });
});

describe("what the rules updated last", () => {
  it("reads podinfo's move from 6.13.0 to 6.14.1 out of the controller's message", () => {
    const rows = recentUpdates(imageUpdaters());

    expect(rows.map((row) => row.updater).sort()).toEqual(["podinfo-chart", "podinfo-patches"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        alias: "podinfo",
        image: "ghcr.io/stefanprodan/podinfo",
        from: "6.13.0",
        to: "6.14.1",
        applications: 1,
      });
    }
  });
});

describe("the page's headline", () => {
  it("states a number only once the rules were read", () => {
    expect(describeRulesHeadline("connecting", 0, 0)).toMatch(/Looking/);
    expect(describeRulesHeadline("unreachable", 0, 0)).toMatch(/Cannot read/);
    expect(describeRulesHeadline("not-installed", 0, 0)).toMatch(/No Image Updater rules/);
    expect(describeRulesHeadline("ready", 0, 0)).toMatch(/No Image Updater rules/);
    expect(describeRulesHeadline("ready", 0, 3)).toBe("All 3 Image Updater rules are watching");
    expect(describeRulesHeadline("ready", 2, 6)).toBe("2 of 6 Image Updater rules need attention");
  });
});

describe("what the page singles out", () => {
  it("lists the broken and the idle rules, not the working or the waiting ones", () => {
    const rows = rankRules(imageUpdaters(), applications(), checkedNow());

    expect(needingAttention(rows).map((row) => row.updater.getName())).toEqual([
      "bad-pattern",
      "frontend-private",
      "plain-manifests",
      "retired",
    ]);
  });

  it("explains a page with no number on it", () => {
    expect(describeRulesState("connecting")).toMatch(/Connecting/);
    expect(describeRulesState("unreachable")).toMatch(/Could not read/);
    expect(describeRulesState("not-installed")).toMatch(/no ImageUpdater CRD/);
    expect(describeRulesState("ready")).toBeUndefined();
  });
});

/** Each case is one field away from a real seeded rule. */
describe("the shapes a rule can take beyond the seeded ones", () => {
  it("reaches nothing from another namespace", () => {
    const moved = imageUpdater("podinfo-patches");
    (moved.metadata as { namespace: string }).namespace = "demo";

    expect(selectApplications(moved, applications())).toEqual([]);
  });

  it("counts the other skipped Applications when a pattern names several", () => {
    const wide = imageUpdater("plain-manifests");
    (wide.spec.applicationRefs[0] as { namePattern: string }).namePattern = "guestbook*";

    const health = ruleHealth(wide, applications(), checkedNow());

    expect(health.state).toBe("skipped");
    expect(health.reason).toMatch(/^Names guestbook\S* and \d+ more/);
  });

  it("calls a multi-source Application with no Helm or Kustomize part a directory", () => {
    const plain = application("podinfo");
    plain.status = { ...plain.status, sourceTypes: ["Directory", "Directory"] };

    expect(unsupportedReason(plain)).toMatch(/directory source/);

    plain.status = { ...plain.status, sourceTypes: [] };
    expect(unsupportedReason(plain)).toMatch(/not reported/);
  });

  it("watches no image for a reference that lists none", () => {
    const empty = imageUpdater("podinfo-patches");
    delete (empty.spec.applicationRefs[0] as { images?: unknown }).images;

    expect(trackedImages([empty], applications())).toEqual([]);
  });

  it("reads an annotation list without aliases, and the Application-wide strategy", () => {
    const legacy = application("legacy-annotations");
    legacy.metadata.annotations = {
      "argocd-image-updater.argoproj.io/image-list": "ghcr.io/stefanprodan/podinfo:6.13.x, ",
      "argocd-image-updater.argoproj.io/update-strategy": "digest",
    };

    expect(trackedImages([imageUpdater("from-annotations")], [legacy])).toEqual([
      expect.objectContaining({
        alias: "ghcr.io/stefanprodan/podinfo",
        constraint: "6.13.x",
        strategy: "digest",
        writeBack: "the Application, in the cluster",
      }),
    ]);

    legacy.metadata.annotations = { "argocd-image-updater.argoproj.io/image-list": "nginx" };
    expect(trackedImages([imageUpdater("from-annotations")], [legacy])[0]?.strategy).toBe("semver");
  });

  it("watches nothing on an Application the rule selects but that carries no list", () => {
    const bare = application("legacy-annotations");
    delete bare.metadata.annotations;

    expect(trackedImages([imageUpdater("from-annotations")], [bare])).toEqual([]);
  });

  it("orders the last updates newest first, and survives a message it cannot read", () => {
    const earlier = imageUpdater("podinfo-patches");
    const later = imageUpdater("podinfo-patches");
    const update = later.status?.recentUpdates?.[0] as NonNullable<
      NonNullable<typeof later.status>["recentUpdates"]
    >[number];
    (later.metadata as { name: string }).name = "later";
    later.status = {
      ...later.status,
      recentUpdates: [{ ...update, updatedAt: "2999-01-01T00:00:00Z", message: undefined }],
    };

    const rows = recentUpdates([earlier, later]);

    expect(rows.map((row) => row.updater)).toEqual(["later", "podinfo-patches"]);
    expect(rows[0]?.from).toBeUndefined();
  });
});

describe("where each image's update is written", () => {
  it("is the Application for every seeded rule, and git when a rule says so", () => {
    expect(trackedImages(imageUpdaters(), applications()).every((row) => !row.writesToGit)).toBe(
      true,
    );

    const toGit = imageUpdater("podinfo-patches");
    toGit.spec.writeBackConfig = { method: "git", gitConfig: { branch: "main" } };

    expect(trackedImages([toGit], applications())[0]).toMatchObject({
      writesToGit: true,
      writeBack: "a commit to the Application's repository, branch main",
    });
  });
});

describe("how many images are really watched", () => {
  it("counts only those reaching an Application the controller updates", () => {
    const rows = trackedImages(imageUpdaters(), applications());

    expect(rows).toHaveLength(7);
    expect(countWatching(rows)).toBe(4);
  });
});

describe("whether the controller may be restarted", () => {
  it("refuses while a rule the controller rejects exists, naming it", () => {
    const rows = rankRules(imageUpdaters(), applications(), checkedNow());

    expect(restartRefusal(rows)).toMatch(/refuses bad-pattern.*crash-looping.*that rule/);
  });

  it("names every such rule", () => {
    const rows = rankRules(imageUpdaters(), applications(), checkedNow());
    const twice = [...rows, ...rows.filter((row) => row.health.state === "failing")];

    expect(restartRefusal(twice)).toMatch(/those rules/);
  });

  it("allows it when no rule is refused", () => {
    const rows = rankRules(imageUpdaters(), applications(), checkedNow()).filter(
      (row) => row.health.state !== "failing",
    );

    expect(restartRefusal(rows)).toBeUndefined();
  });
});
