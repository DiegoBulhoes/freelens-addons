import { describe, expect, it } from "vitest";

import {
  applicationSetVerdict,
  conditionRows,
  describeApplicationSetsState,
  describeGenerator,
  describeGenerators,
  describeSyncPolicy,
  ownedApplications,
  rankApplicationSets,
  SET_COLUMNS,
  SET_SORT,
  setSearchTexts,
  summariseOwned,
  templateDestination,
  templateSources,
} from "../../src/renderer/api/application-sets/application-set";
import { keyFor, namedKey } from "../../src/renderer/api/shared/identity";
import {
  application,
  applicationSet,
  applicationSets,
  applications,
  setVariantOf,
} from "../support/fixtures";

const LIST = { list: { elements: [{ env: "blue" }] } };

describe("an ApplicationSet's generators", () => {
  it("names each by its kind, and what a matrix or merge combines", () => {
    expect(describeGenerators(applicationSet("guestbooks"))).toBe("list");

    const matrix = setVariantOf("guestbooks", (data) => {
      data.spec.generators = [
        {
          matrix: {
            generators: [{ git: { repoURL: "https://example.test/repo.git" } }, LIST],
          },
        },
        { selector: { matchLabels: { tier: "web" } }, ...LIST },
      ];
    });

    expect(describeGenerators(matrix)).toBe("matrix(git, list), list");
    expect(
      describeGenerators(setVariantOf("guestbooks", (data) => delete data.spec.generators)),
    ).toBe("none");
  });

  it("shows a list's elements in full", () => {
    const [guestbooks] = applicationSet("guestbooks").spec.generators ?? [];
    const [broken] = applicationSet("broken-template").spec.generators ?? [];

    expect(guestbooks && describeGenerator(guestbooks)).toEqual({
      kind: "list",
      summary: "2 elements",
      fields: [{ name: "elements", value: '[{"env":"blue"},{"env":"green"}]' }],
      nested: [],
    });
    expect(broken && describeGenerator(broken).summary).toBe("1 element");
    expect(describeGenerator({ list: { elementsYaml: "{{ .items }}" } }).summary).toBe(
      "elements from a template",
    );
  });

  it("says where git and cluster generators read from, and keeps their selector", () => {
    expect(
      describeGenerator({ git: { repoURL: "https://example.test/repo.git", revision: "main" } })
        .summary,
    ).toBe("https://example.test/repo.git @ main");
    expect(describeGenerator({ git: {} }).summary).toBe("?");
    expect(describeGenerator({ clusters: {} })).toEqual({
      kind: "clusters",
      summary: "every cluster",
      fields: [],
      nested: [],
    });
    expect(
      describeGenerator({ clusters: { selector: { matchLabels: { env: "prod" } } } }).summary,
    ).toBe("the clusters its selector matches");
    expect(describeGenerator({ selector: { matchLabels: { env: "a" } }, ...LIST }).fields).toEqual([
      { name: "elements", value: '[{"env":"blue"}]' },
      { name: "selector", value: '{"matchLabels":{"env":"a"}}' },
    ]);
  });

  it("draws a matrix's generators inside it rather than as a field", () => {
    const view = describeGenerator({
      merge: {
        mergeKeys: ["env"],
        generators: [LIST, { plugin: { configMapRef: { name: "p" } } }],
      },
    });

    expect(view.summary).toBe("combines 2 generators");
    expect(view.fields).toEqual([{ name: "mergeKeys", value: '["env"]' }]);
    expect(view.nested.map((nested) => [nested.kind, nested.summary])).toEqual([
      ["list", "1 element"],
      ["plugin", ""],
    ]);
    expect(describeGenerator({ matrix: "nonsense" }).fields).toEqual([]);
    expect(describeGenerator({}).kind).toBe("unknown");
  });
});

describe("the Applications an ApplicationSet owns", () => {
  it("finds them by owner reference", () => {
    const owned = ownedApplications(applicationSet("guestbooks"), applications());

    expect(owned.map((each) => each.getName())).toEqual(["guestbook-blue", "guestbook-green"]);
    expect(ownedApplications(applicationSet("broken-template"), applications())).toEqual([]);
  });

  it("does not take another set's Applications for its own because it shares the name", () => {
    const namesake = setVariantOf("guestbooks", (data) => {
      data.metadata.uid = "00000000-0000-0000-0000-000000000000";
    });

    expect(ownedApplications(namesake, applications())).toEqual([]);
  });

  it("sums up their sync and health, worst tone first", () => {
    expect(
      summariseOwned(ownedApplications(applicationSet("guestbooks"), applications()), "ready"),
    ).toEqual({
      count: 2,
      tone: "ok",
      label: "synced and healthy",
      title: "guestbook-blue: Synced, Healthy\nguestbook-green: Synced, Healthy",
    });
    expect(summariseOwned([], "ready")).toMatchObject({
      count: 0,
      tone: "info",
      label: "none",
      title: "",
    });
    expect(summariseOwned([application("helm-guestbook")], "ready")).toMatchObject({
      tone: "warning",
      label: "1 OutOfSync",
    });
    expect(
      summariseOwned([application("helm-guestbook"), application("bad-namespace")], "ready"),
    ).toMatchObject({
      tone: "critical",
      label: "2 OutOfSync, 1 Missing",
    });
    expect(
      summariseOwned([application("bad-namespace"), application("helm-guestbook")], "ready").tone,
    ).toBe("critical");
    expect(summariseOwned([application("image-updates")], "ready")).toMatchObject({
      tone: "critical",
      label: "1 Degraded",
    });
  });
});

describe("an ApplicationSet whose Applications are not read", () => {
  it.each(["connecting", "unreachable", "not-installed"] as const)(
    "gives no count while the list is %s, not none",
    (state) => {
      const [row] = rankApplicationSets([applicationSet("guestbooks")], [], state);

      expect(row?.summary).toEqual({
        count: undefined,
        tone: "info",
        label: "not read",
        title: "",
      });
      expect(row && SET_SORT[SET_COLUMNS.applications]?.(row)).toBe(-1);
    },
  );

  it("gives none once the list is read and holds no Application of it", () => {
    const [row] = rankApplicationSets([applicationSet("guestbooks")], [], "ready");

    expect(row?.summary).toMatchObject({ count: 0, label: "none" });
  });
});

describe("an ApplicationSet's verdict", () => {
  it("is an error, with the controller's reason and message, when generation fails", () => {
    expect(applicationSetVerdict(applicationSet("broken-template"))).toEqual({
      tone: "critical",
      label: "Error",
      cause: "RenderTemplateParamsError",
      reason:
        'failed to execute go template broken-{{.region}}: template: base:1:9: executing "base" at <.region>: map has no entry for key "region"',
    });
  });

  it("is up to date when its Applications match what it generates", () => {
    expect(applicationSetVerdict(applicationSet("guestbooks"))).toEqual({
      tone: "ok",
      label: "Up to date",
      cause: "ApplicationSetUpToDate",
      reason: "All applications have been generated successfully",
    });
  });

  const withConditions = (statuses: Record<string, string>, message = "") =>
    setVariantOf("guestbooks", (data) => {
      for (const condition of data.status?.conditions ?? []) {
        const status = statuses[condition.type as string];

        if (status) condition.status = status;
        condition.message = message;
      }
    });

  it("reads the other conditions only once no error is reported", () => {
    expect(applicationSetVerdict(withConditions({ ParametersGenerated: "False" }))).toMatchObject({
      tone: "critical",
      label: "No parameters",
      reason: "Its generators produced no parameters.",
    });
    expect(applicationSetVerdict(withConditions({ ResourcesUpToDate: "False" }))).toMatchObject({
      tone: "warning",
      label: "Not up to date",
      reason: "Its Applications do not match what it generates.",
    });
    expect(
      applicationSetVerdict(withConditions({ ErrorOccurred: "True", ResourcesUpToDate: "False" })),
    ).toMatchObject({
      label: "Error",
      reason: "The controller could not generate its Applications.",
    });
    expect(applicationSetVerdict(withConditions({}, "")).reason).toBe(
      "Its Applications match what it generates.",
    );
  });

  it("says nothing was reported before the controller wrote a status", () => {
    const fresh = setVariantOf("guestbooks", (data) => delete data.status);
    const unknown = withConditions({ ResourcesUpToDate: "Unknown" });

    expect(applicationSetVerdict(fresh)).toEqual({
      tone: "info",
      label: "Not reported",
      reason: "The ApplicationSet controller has not reported on it yet.",
    });
    expect(applicationSetVerdict(unknown).label).toBe("Not reported");
  });

  it("lists each condition, marking the ones that report a problem", () => {
    expect(
      conditionRows(applicationSet("broken-template")).map((row) => [row.type, row.failing]),
    ).toEqual([
      ["ErrorOccurred", true],
      ["ParametersGenerated", true],
      ["ResourcesUpToDate", true],
    ]);
    expect(conditionRows(applicationSet("guestbooks")).some((row) => row.failing)).toBe(false);
    expect(
      conditionRows(
        setVariantOf("guestbooks", (data) => {
          data.status = { conditions: [{ type: "RolloutProgressing", status: "True" }] };
        }),
      ),
    ).toEqual([
      { type: "RolloutProgressing", status: "True", reason: "", message: "", failing: false },
    ]);
    expect(conditionRows(setVariantOf("guestbooks", (data) => delete data.status))).toEqual([]);
  });
});

describe("an ApplicationSet's template and sync policy", () => {
  it("reads the source and destination it gives each Application", () => {
    const set = applicationSet("guestbooks");

    expect(templateSources(set)).toEqual([
      {
        path: "guestbook",
        repoURL: "https://github.com/argoproj/argocd-example-apps.git",
        targetRevision: "HEAD",
      },
    ]);
    expect(templateDestination(set)).toBe("in-cluster/guestbook-{{.env}}");
  });

  it("prefers several sources to one, and a destination by name or namespace alone", () => {
    const template = (change: (spec: Record<string, unknown>) => void) =>
      setVariantOf("guestbooks", (data) => {
        change((data.spec.template as { spec: Record<string, unknown> }).spec);
      });

    const multi = template((spec) => {
      spec.sources = [{ repoURL: "a" }, { repoURL: "b" }];
    });
    const named = template((spec) => {
      spec.destination = { name: "prod", namespace: "web" };
    });
    const bare = template((spec) => {
      delete spec.source;
      spec.sources = [];
      spec.destination = { namespace: "web" };
    });

    expect(templateSources(multi).map((source) => source.repoURL)).toEqual(["a", "b"]);
    expect(templateDestination(named)).toBe("prod/web");
    expect(templateSources(bare)).toEqual([]);
    expect(templateDestination(bare)).toBe("web");
    expect(
      templateDestination(setVariantOf("guestbooks", (data) => delete data.spec.template)),
    ).toBe("—");
  });

  it("says what it does to its Applications, and what deleting it leaves", () => {
    expect(describeSyncPolicy(applicationSet("guestbooks"))).toEqual([
      {
        label: "Applications sync",
        value: "create-update: creates and updates its Applications, never deletes them",
      },
      { label: "When deleted", value: "deletes its Applications and keeps what they deployed" },
    ]);
    expect(describeSyncPolicy(applicationSet("broken-template"))).toEqual([
      {
        label: "Applications sync",
        value:
          "the controller's: creates, updates and deletes its Applications, unless it was started with another policy",
      },
      { label: "When deleted", value: "deletes its Applications and what they deployed" },
    ]);

    const unknown = setVariantOf("guestbooks", (data) => {
      data.spec.syncPolicy = { applicationsSync: "create-everything" };
    });

    expect(describeSyncPolicy(unknown)[0]?.value).toBe(
      "create-everything: a policy this page does not know",
    );
  });
});

describe("the ApplicationSets list", () => {
  const rows = rankApplicationSets(applicationSets(), applications(), "ready");

  it("puts a failing set first, each with what it owns", () => {
    expect(
      rows.map((row) => [
        row.set.getName(),
        row.verdict.label,
        row.owned.length,
        row.summary.label,
      ]),
    ).toEqual([
      ["broken-template", "Error", 0, "none"],
      ["guestbooks", "Up to date", 2, "synced and healthy"],
    ]);
  });

  it("sorts by name when the verdicts tie", () => {
    const twin = setVariantOf("guestbooks", (data) => {
      data.metadata.name = "another";
    });

    expect(
      rankApplicationSets([applicationSet("guestbooks"), twin], applications(), "ready").map(
        (row) => row.set.getName(),
      ),
    ).toEqual(["another", "guestbooks"]);
  });

  it("sorts and searches by what each column shows", () => {
    const [broken, guestbooks] = rows;

    if (!broken || !guestbooks) throw new Error("the fixtures lost an ApplicationSet");

    const sort = (column: string) => [broken, guestbooks].map((row) => SET_SORT[column]?.(row));

    expect(sort(SET_COLUMNS.name)).toEqual(["broken-template", "guestbooks"]);
    expect(sort(SET_COLUMNS.namespace)).toEqual(["argocd", "argocd"]);
    expect(sort(SET_COLUMNS.generators)).toEqual(["list", "list"]);
    expect(sort(SET_COLUMNS.applications)).toEqual([0, 2]);
    expect(sort(SET_COLUMNS.conditions)).toEqual([0, 3]);
    expect(setSearchTexts(guestbooks)).toEqual([
      "guestbooks",
      "argocd",
      "list",
      "Up to date",
      "guestbook-blue",
      "guestbook-green",
    ]);
  });

  it("opens the drawer a link names, and only when it names both", () => {
    expect(keyFor("guestbooks", "argocd")).toBe("argocd/guestbooks");
    expect(keyFor("guestbooks", undefined)).toBe("/guestbooks");
    expect(namedKey("guestbooks", "argocd")).toBe("argocd/guestbooks");
    expect(namedKey("guestbooks", "")).toBeUndefined();
    expect(namedKey(undefined, "argocd")).toBeUndefined();
  });

  it("says why the list is empty before it is read", () => {
    expect(describeApplicationSetsState("connecting")).toBe("Connecting to the cluster…");
    expect(describeApplicationSetsState("unreachable")).toBe(
      "Could not read the ApplicationSets, so what is below may be incomplete.",
    );
    expect(describeApplicationSetsState("not-installed")).toBe(
      "This cluster has no ApplicationSet CRD.",
    );
    expect(describeApplicationSetsState("ready")).toBeUndefined();
  });
});
