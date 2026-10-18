import { describe, expect, it } from "vitest";

import {
  addFailure,
  afterPass,
  describeFailures,
  describeHeadline,
  describeLoadState,
  EVERYWHERE,
  emptyText,
  type Failures,
  failedNamespacesOf,
  loadedForScope,
  loadState,
  NO_FAILURES,
  refusedEverywhere,
  type StoreFacts,
  settleFailures,
  worstOf,
} from "../../src/renderer/api/shared/store-state";

// The host's `loadAll` never rejects: an unreachable cluster arrives as an empty store plus a flag.

const facts = (over: Partial<StoreFacts> = {}): StoreFacts => ({
  registered: true,
  loaded: false,
  refused: false,
  itemCount: 0,
  gaveUp: false,
  ...over,
});

describe("deciding whether the page knows anything", () => {
  it("is ready once a load has finished", () => {
    expect(loadState(facts({ loaded: true, itemCount: 57 }))).toBe("ready");
  });

  it("is ready when a load finished and the cluster really has none", () => {
    expect(loadState(facts({ loaded: true, itemCount: 0 }))).toBe("ready");
    expect(describeHeadline("ready", 0, 0)).toBe("No ArgoCD Applications found");
  });

  it("says the CRD is absent rather than that the cluster is broken", () => {
    expect(loadState(facts({ registered: false }))).toBe("not-installed");
    expect(describeLoadState("not-installed")).toContain("No ArgoCD Applications");
  });

  it("says unreachable once the retries are spent with nothing to show", () => {
    expect(loadState(facts({ refused: true, gaveUp: true }))).toBe("unreachable");
    expect(describeLoadState("unreachable")).toContain("Could not read");
  });

  it("says unreachable for a list that never answered once the retries are spent", () => {
    expect(loadState(facts({ gaveUp: true }))).toBe("unreachable");
  });

  it("never states a count it cannot stand behind", () => {
    for (const state of ["not-installed", "connecting", "unreachable"] as const) {
      const headline = describeHeadline(state, 0, 0);

      expect(headline).not.toMatch(/\d+ of \d+/);
      expect(headline).not.toContain("synced and healthy");
    }
  });
});

describe("deciding during a normal startup", () => {
  it("is connecting while the retry budget is unspent, even after a failure", () => {
    // Early failures are normal while the cluster connects.
    expect(loadState(facts({ refused: true, gaveUp: false }))).toBe("connecting");
  });

  it("does not alarm before the first attempt has even run", () => {
    expect(loadState(facts())).toBe("connecting");
    expect(describeLoadState("connecting")).toBe("Connecting to the cluster…");
  });

  it("goes ready the moment items arrive, whatever happened before", () => {
    expect(loadState(facts({ refused: true, gaveUp: true, itemCount: 12 }))).toBe("ready");
  });

  it("gives no note at all once it is ready, so the page is quiet when it should be", () => {
    expect(describeLoadState("ready")).toBeUndefined();
  });
});

describe("deciding from facts that contradict each other", () => {
  it("does not read a list refused everywhere as an empty cluster, though it reads loaded", () => {
    expect(loadState(facts({ loaded: true, refused: true }))).toBe("connecting");
    expect(loadState(facts({ loaded: true, refused: true, gaveUp: true }))).toBe("unreachable");
  });

  it("calls an unregistered store not-installed however else it looks", () => {
    expect(loadState(facts({ registered: false, loaded: true, itemCount: 9, gaveUp: true }))).toBe(
      "not-installed",
    );
  });

  it("does not call a store unreachable while it still holds items", () => {
    expect(loadState(facts({ refused: true, gaveUp: true, itemCount: 1 }))).toBe("ready");
  });

  it("counts attention against the total it was given, not against itself", () => {
    expect(describeHeadline("ready", 4, 57)).toBe("4 of 57 Applications need attention");
    expect(describeHeadline("ready", 0, 57)).toBe("All 57 Applications are synced and healthy");
  });

  it("speaks of a single Application in the singular", () => {
    expect(describeHeadline("ready", 0, 1)).toBe("The only Application is synced and healthy");
    expect(describeHeadline("ready", 1, 1)).toBe("1 of 1 Application needs attention");
  });
});

// What the host passes to onLoadFailure: its own Error, with the API's refusal as the cause.
function refusal(message: string): Error {
  return new Error("Failed to load /apis/argoproj.io/v1alpha1/applications", {
    cause: { toString: () => message },
  });
}

const SCOPE = ["argocd", "demo"];
const FORBIDDEN_IN_DEMO =
  'applications.argoproj.io is forbidden: User "dev" cannot list resource "applications" in API group "argoproj.io" in the namespace "demo"';
const FORBIDDEN_CLUSTER_WIDE =
  'applications.argoproj.io is forbidden: User "dev" cannot list resource "applications" in API group "argoproj.io" at the cluster scope';

function failures(entries: [string, string[]][]): Failures {
  const built = new Map<string, Set<string>>();

  for (const [kind, namespaces] of entries) addFailure(built, kind, namespaces);

  return built;
}

describe("a list refused in some namespaces", () => {
  it("takes the namespace the API names in its refusal", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_IN_DEMO), SCOPE)).toEqual(["demo"]);
  });

  it("counts a refusal that names no namespace against all of them", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_CLUSTER_WIDE), SCOPE)).toEqual(SCOPE);
    expect(failedNamespacesOf(new Error("No answer in 20s"), SCOPE)).toEqual(SCOPE);
  });

  it("ignores a namespace the refusal names that was not asked for", () => {
    expect(
      failedNamespacesOf(refusal(FORBIDDEN_IN_DEMO.replace('"demo"', '"other"')), SCOPE),
    ).toEqual(SCOPE);
  });

  it("records a store loaded without namespaces against the cluster", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_CLUSTER_WIDE), [])).toEqual([EVERYWHERE]);
  });

  it("is refused everywhere only when every namespace in scope refused", () => {
    const demoOnly = failures([["Application", ["demo"]]]);

    expect(refusedEverywhere(demoOnly, "Application", SCOPE)).toBe(false);
    expect(refusedEverywhere(failures([["Application", SCOPE]]), "Application", SCOPE)).toBe(true);
    expect(refusedEverywhere(demoOnly, "AppProject", SCOPE)).toBe(false);
    expect(refusedEverywhere(failures([["Node", [EVERYWHERE]]]), "Node", [])).toBe(true);
  });

  it("names what it could not read, the cluster included, and nothing when all answered", () => {
    const refused = failures([
      ["Application", ["demo", "argocd"]],
      ["AppProject", [EVERYWHERE]],
    ]);

    expect(
      describeFailures(refused, { Application: "Applications", AppProject: "AppProjects" }),
    ).toBe(
      "Could not read Applications in argocd, demo; AppProjects in the cluster, so what is below leaves them out.",
    );
    expect(describeFailures(NO_FAILURES, { Application: "Applications" })).toBeUndefined();
    expect(describeFailures(refused, { ImageUpdater: "rules" })).toBeUndefined();
  });

  it("replaces only the outcome of the kinds it listed again", () => {
    const before = failures([
      ["Application", ["demo"]],
      ["AppProject", ["demo"]],
    ]);
    const settled = settleFailures(before, ["Application"], NO_FAILURES);

    expect([...settled.keys()]).toEqual(["AppProject"]);
    const retried = settleFailures(before, ["AppProject"], failures([["AppProject", ["argocd"]]]));

    expect(retried.get("AppProject")).toEqual(new Set(["argocd"]));
    expect(retried.get("Application")).toEqual(new Set(["demo"]));
  });
});

describe("one pass over the stores", () => {
  it("watches each store that loaded at once, without waiting for one that did not", () => {
    const outcome = afterPass(
      ["Application", "AppProject"],
      (kind) => kind === "Application",
      NO_FAILURES,
    );

    expect(outcome).toEqual({ subscribe: ["Application"], retry: ["AppProject"] });
  });

  it("lists again only a kind refused somewhere, not the ones that answered", () => {
    const outcome = afterPass(
      ["Application", "AppProject"],
      () => true,
      failures([["AppProject", ["demo"]]]),
    );

    expect(outcome).toEqual({ subscribe: ["Application", "AppProject"], retry: ["AppProject"] });
  });

  it("is done once every kind loaded and none was refused", () => {
    expect(afterPass(["Application"], () => true, failures([["Application", []]]))).toEqual({
      subscribe: ["Application"],
      retry: [],
    });
  });
});

describe("a page that stands on the current scope", () => {
  it("is loaded only for the scope its own load finished in", () => {
    const loaded = { isLoaded: true };

    expect(loadedForScope([loaded], "argocd,demo", "argocd,demo")).toBe(true);
    expect(loadedForScope([loaded], "argocd", "argocd,demo")).toBe(false);
    expect(loadedForScope([loaded], undefined, "")).toBe(false);
    expect(loadedForScope([loaded, { isLoaded: false }], "argocd", "argocd")).toBe(false);
    expect(loadedForScope([undefined], "argocd", "argocd")).toBe(false);
  });

  it("is only as ready as its least ready list", () => {
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf("not-installed", "unreachable", "ready")).toBe("unreachable");
    expect(worstOf("ready", "not-installed")).toBe("not-installed");
    expect(worstOf("ready")).toBe("ready");
    expect(worstOf()).toBe("ready");
  });
});

describe("a list's empty text", () => {
  const empty = "No rule names an image yet.";

  it("says there is nothing only once the list is known", () => {
    expect(emptyText("ready", describeLoadState, empty)).toBe(empty);
    expect(emptyText("connecting", describeLoadState, empty)).toBe("Connecting to the cluster…");
    expect(emptyText("not-installed", describeLoadState, empty)).toBe(
      describeLoadState("not-installed"),
    );
  });

  it("does not repeat the head's alarm when nothing could be read", () => {
    expect(emptyText("unreachable", describeLoadState, empty)).toBe(
      "Nothing could be read, so nothing is listed.",
    );
  });

  it("falls back to the empty text when a state has nothing to say", () => {
    expect(emptyText("connecting", () => undefined, empty)).toBe(empty);
  });
});
