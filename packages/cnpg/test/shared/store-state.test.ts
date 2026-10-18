import { describe, expect, it } from "vitest";

import {
  afterLoad,
  describeFailures,
  describeLoadState,
  EVERYWHERE,
  emptyText,
  type Failures,
  failedEverywhere,
  failedNamespacesOf,
  type KindStates,
  kindNote,
  loadedForScope,
  loadState,
  MAX_LOAD_ATTEMPTS,
  optional,
  pageLoad,
  readableScope,
  type StorePage,
  shownScope,
  worstOf,
} from "../../src/renderer/api/shared/store-state";

const base = { registered: true, loaded: false, gaveUp: false };

const ready: KindStates = {
  clusters: "ready",
  backups: "ready",
  schedules: "ready",
  poolers: "ready",
  objectStores: "ready",
  publications: "ready",
  subscriptions: "ready",
  pods: "ready",
  budgets: "ready",
};

describe("what the pages know about their stores", () => {
  it("is not installed until the API is registered", () => {
    expect(loadState({ ...base, registered: false, loaded: true })).toBe("not-installed");
  });

  it("is ready once loaded for the scope shown", () => {
    expect(loadState({ ...base, loaded: true })).toBe("ready");
  });

  it("is connecting until the retries give up, then unreachable", () => {
    expect(loadState(base)).toBe("connecting");
    expect(loadState({ ...base, gaveUp: true })).toBe("unreachable");
  });

  it("is loaded only for the scope its own load completed for", () => {
    const loaded = [{ isLoaded: true }];

    expect(loadedForScope(loaded, "databases", "databases")).toBe(true);
    expect(loadedForScope(loaded, "databases", "databases,staging")).toBe(false);
    expect(loadedForScope(loaded, undefined, "")).toBe(false);
    expect(loadedForScope([{ isLoaded: false }], "databases", "databases")).toBe(false);
  });

  it("is as bad as the worst of the lists a page stands on", () => {
    expect(worstOf("ready", "connecting", "unreachable")).toBe("unreachable");
    expect(worstOf("ready", "not-installed", "connecting")).toBe("connecting");
    expect(worstOf("ready", "not-installed")).toBe("not-installed");
    expect(worstOf("ready", "ready")).toBe("ready");
    expect(worstOf()).toBe("ready");
  });

  it("takes a missing optional CRD as nothing to read", () => {
    expect(optional("not-installed")).toBe("ready");
    expect(optional("unreachable")).toBe("unreachable");
  });

  it("says nothing when ready, and why otherwise", () => {
    expect(describeLoadState("ready")).toBeUndefined();
    expect(describeLoadState("not-installed")).toContain("not installed");
    expect(describeLoadState("connecting")).toContain("Connecting");
    expect(describeLoadState("unreachable")).toBe(
      "Could not read the Postgres clusters, so what is below may be incomplete.",
    );
  });
});

describe("each page's load state", () => {
  it("is ready, with nothing to say, when every list is", () => {
    const pages: StorePage[] = [
      "overview",
      "clusters",
      "backups",
      "schedules",
      "poolers",
      "logical",
    ];

    for (const page of pages) {
      expect(pageLoad(ready, page)).toEqual({
        state: "ready",
        note: undefined,
        alarm: false,
      });
    }
  });

  it("does not read an unread Backup list as no backups", () => {
    const refused = { ...ready, backups: "unreachable" as const };

    expect(pageLoad(refused, "backups")).toEqual({
      state: "unreachable",
      note: "Could not read the Backups, so what is below may be incomplete.",
      alarm: true,
    });
    expect(pageLoad(refused, "clusters").state).toBe("unreachable");
    expect(pageLoad(refused, "schedules").state).toBe("unreachable");
    expect(pageLoad(refused, "poolers").state).toBe("ready");
  });

  it("leaves an empty list read from nothing to say only that, the head carrying the alarm", () => {
    const empty = "No Backup objects in the namespaces in scope.";
    const failures: Failures = { backups: new Set(["staging"]) };

    expect(emptyText(pageLoad({ ...ready, backups: "unreachable" }, "backups"), empty)).toBe(
      "Nothing could be read, so nothing is listed.",
    );
    expect(emptyText(pageLoad({ ...ready, backups: "connecting" }, "backups"), empty)).toBe(
      "Connecting to the cluster…",
    );
    expect(emptyText(pageLoad(ready, "backups", failures), empty)).toBe(
      "Could not read Backups in staging, so those namespaces are left out.",
    );
    expect(emptyText(pageLoad(ready, "backups"), empty)).toBe(empty);
  });

  it("keeps the overview from saying all clear until every list it judges by is read", () => {
    for (const kind of Object.keys(ready) as (keyof KindStates)[]) {
      const waiting: KindStates = { ...ready, [kind]: "connecting" };

      // Budgets are read only by the cluster drawer.
      expect(pageLoad(waiting, "overview").state).toBe(kind === "budgets" ? "ready" : "connecting");
    }
    expect(pageLoad({ ...ready, pods: "unreachable" }, "overview").note).toBe(
      "Could not read every CloudNativePG list, so what is below may be incomplete.",
    );
  });

  it("judges poolers by their pods and schedules by their backups", () => {
    expect(pageLoad({ ...ready, pods: "connecting" }, "poolers").note).toBe(
      "Connecting to the cluster…",
    );
    expect(pageLoad({ ...ready, clusters: "unreachable" }, "poolers").note).toBe(
      "Could not read the poolers, their clusters or their pods, so what is below may be incomplete.",
    );
    expect(pageLoad({ ...ready, backups: "connecting" }, "schedules").state).toBe("connecting");
  });

  it("does not wait for the Barman Cloud plugin or the logical replication CRDs when absent", () => {
    const without = {
      ...ready,
      objectStores: "not-installed" as const,
      publications: "not-installed" as const,
      subscriptions: "not-installed" as const,
    };

    expect(pageLoad(without, "overview").state).toBe("ready");
    expect(pageLoad(without, "clusters").state).toBe("ready");
    expect(pageLoad(without, "logical").state).toBe("ready");
    expect(pageLoad({ ...ready, subscriptions: "unreachable" }, "logical").note).toBe(
      "Could not read the publications or subscriptions, so what is below may be incomplete.",
    );
  });
});

const SCOPE = ["databases", "staging"];

// What the host hands onLoadFailure: its own Error, with the API's refusal as the cause.
function refusal(message: string): Error {
  return new Error("Failed to load /apis/postgresql.cnpg.io/v1/backups", {
    cause: { toString: () => message },
  });
}

const FORBIDDEN_IN_STAGING =
  'backups.postgresql.cnpg.io is forbidden: User "dev" cannot list resource "backups" in API group "postgresql.cnpg.io" in the namespace "staging"';

describe("a list refused in some namespaces", () => {
  it("takes the namespace the API names in its refusal", () => {
    expect(failedNamespacesOf(refusal(FORBIDDEN_IN_STAGING), SCOPE)).toEqual(["staging"]);
    expect(failedNamespacesOf(FORBIDDEN_IN_STAGING, SCOPE)).toEqual(["staging"]);
  });

  it("counts a refusal that names no namespace in scope against all of them", () => {
    expect(failedNamespacesOf(new Error("No answer in 20s"), SCOPE)).toEqual(SCOPE);
    expect(failedNamespacesOf(refusal(FORBIDDEN_IN_STAGING), ["databases"])).toEqual(["databases"]);
    expect(failedNamespacesOf(undefined, [])).toEqual([EVERYWHERE]);
  });

  it("survives a refusal whose cause leads back to itself", () => {
    const looped = new Error("looped") as Error & { cause?: unknown };

    looped.cause = looped;

    expect(failedNamespacesOf(looped, SCOPE)).toEqual(SCOPE);
  });

  it("is not ready when refused in every namespace in scope, only then", () => {
    const loaded = { registered: true, loaded: true, gaveUp: false };

    expect(failedEverywhere(new Set(SCOPE), SCOPE)).toBe(true);
    expect(failedEverywhere(new Set(["staging"]), SCOPE)).toBe(false);
    expect(failedEverywhere(new Set(), SCOPE)).toBe(false);
    expect(failedEverywhere(undefined, SCOPE)).toBe(false);
    expect(failedEverywhere(new Set([EVERYWHERE]), [])).toBe(true);
    expect(loadState({ ...loaded, refused: true })).toBe("connecting");
    expect(loadState({ ...loaded, refused: true, gaveUp: true })).toBe("unreachable");
    expect(loadState({ ...loaded, refused: false })).toBe("ready");
  });

  it("lists again while a namespace is refused, and gives up after the last attempt", () => {
    expect(afterLoad({ loaded: true, failed: 0, attempts: 1 })).toBe("done");
    expect(afterLoad({ loaded: true, failed: 1, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: false, failed: 0, attempts: 1 })).toBe("retry");
    expect(afterLoad({ loaded: true, failed: 1, attempts: MAX_LOAD_ATTEMPTS })).toBe("give-up");
    expect(afterLoad({ loaded: true, failed: 0, attempts: MAX_LOAD_ATTEMPTS })).toBe("done");
  });
});

describe("what a page shows when some namespaces were not read", () => {
  const backupsInStaging: Failures = { backups: new Set(["staging"]) };

  it("leaves out the namespaces where a list it stands on was not read", () => {
    expect(readableScope(SCOPE, backupsInStaging, ["backups"])).toEqual(["databases"]);
    expect(readableScope(SCOPE, backupsInStaging, ["poolers"])).toEqual(SCOPE);
    expect(shownScope(SCOPE, backupsInStaging, "clusters", "ready")).toEqual(["databases"]);
    expect(shownScope(SCOPE, backupsInStaging, "schedules", "ready")).toEqual(["databases"]);
    expect(shownScope(SCOPE, backupsInStaging, "poolers", "ready")).toEqual(SCOPE);
    const podsHere: Failures = { pods: new Set(["databases"]) };

    expect(shownScope(SCOPE, podsHere, "poolers", "ready")).toEqual(["staging"]);
    expect(shownScope(SCOPE, podsHere, "overview", "ready")).toEqual(["staging"]);
  });

  it("shows no row while a list it stands on is still loading", () => {
    expect(shownScope(SCOPE, {}, "clusters", "connecting")).toEqual([]);
    expect(shownScope(SCOPE, {}, "clusters", "not-installed")).toEqual(SCOPE);
  });

  it("shows every namespace, as unreachable, once a list was refused in all of them", () => {
    const backupsEverywhere: Failures = { backups: new Set(SCOPE) };

    expect(readableScope(SCOPE, backupsEverywhere, ["backups"])).toEqual(SCOPE);
    expect(shownScope(SCOPE, backupsEverywhere, "clusters", "unreachable")).toEqual(SCOPE);
  });

  it("says which lists were not read where, and keeps the page ready but in alarm", () => {
    expect(pageLoad(ready, "clusters", backupsInStaging)).toEqual({
      state: "ready",
      note: "Could not read Backups in staging, so those namespaces are left out.",
      alarm: true,
    });
    expect(pageLoad(ready, "poolers", backupsInStaging)).toEqual({
      state: "ready",
      note: undefined,
      alarm: false,
    });
    expect(
      describeFailures(
        { pods: new Set(["staging", "databases"]), clusters: new Set([EVERYWHERE]) },
        ["clusters", "pods"],
      ),
    ).toBe(
      "Could not read Postgres clusters in every namespace; Pods in databases, staging, so those namespaces are left out.",
    );
    expect(describeFailures({ pods: new Set() }, ["pods"])).toBeUndefined();
  });

  it("speaks of the whole list, not of namespaces, until it is ready", () => {
    expect(pageLoad({ ...ready, backups: "connecting" }, "backups", backupsInStaging)).toEqual({
      state: "connecting",
      note: "Connecting to the cluster…",
      alarm: false,
    });
  });

  it("says why one cluster's budgets may be missing", () => {
    expect(kindNote("ready", new Set(["staging"]), "staging", "budgets")).toBe(
      "Could not read the PodDisruptionBudgets in staging.",
    );
    expect(kindNote("ready", new Set([EVERYWHERE]), "databases", "budgets")).toBe(
      "Could not read the PodDisruptionBudgets in databases.",
    );
    expect(kindNote("ready", new Set(["staging"]), "databases", "budgets")).toBeUndefined();
    expect(kindNote("ready", undefined, "databases", "budgets")).toBeUndefined();
    expect(kindNote("unreachable", undefined, "databases", "budgets")).toBe(
      "Could not read the PodDisruptionBudgets, so what is below may be incomplete.",
    );
  });
});
