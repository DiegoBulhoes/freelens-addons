import { describe, expect, it } from "vitest";

import { type IssuerIndex, summariseIssuers } from "../../src/renderer/api/issuers/issuers";
import { scopeKey } from "../../src/renderer/api/shared/namespace-scope";
import {
  describeLoadState,
  failedAfterList,
  loadedForScope,
  loadState,
  MAX_LOAD_ATTEMPTS,
  nextLoadStep,
  rowsFor,
  unknownKinds,
  worstOf,
} from "../../src/renderer/api/shared/store-state";
import type { CertManagerKind } from "../../src/renderer/api/shared/types";
import { certificates, issuerIndex } from "../support/fixtures";

const scope = scopeKey(["demo"]);
const loaded = { isLoaded: true };
const listing = { isLoaded: false };
const everyStore = (
  issuerStore: { isLoaded: boolean } | undefined,
): Record<CertManagerKind, { isLoaded: boolean } | undefined> => ({
  Certificate: loaded,
  CertificateRequest: loaded,
  Issuer: issuerStore,
  ClusterIssuer: loaded,
  Order: loaded,
  Challenge: loaded,
});

const KINDS: CertManagerKind[] = [
  "Certificate",
  "CertificateRequest",
  "Issuer",
  "ClusterIssuer",
  "Order",
  "Challenge",
];
const listedFor = (forScope: string): Partial<Record<CertManagerKind, string>> =>
  Object.fromEntries(KINDS.map((kind) => [kind, forScope]));

describe("the load state", () => {
  it("is not installed until the Certificate CRD is registered", () => {
    expect(loadState({ registered: false, loaded: true, gaveUp: false })).toBe("not-installed");
  });

  it("is connecting until every store has listed, then ready", () => {
    expect(loadState({ registered: true, loaded: false, gaveUp: false })).toBe("connecting");
    expect(loadState({ registered: true, loaded: true, gaveUp: false })).toBe("ready");
  });

  it("is unreachable once the retries gave up", () => {
    expect(loadState({ registered: true, loaded: false, gaveUp: true })).toBe("unreachable");
  });

  it("says something for every state but ready", () => {
    expect(describeLoadState("ready")).toBeUndefined();
    for (const state of ["not-installed", "connecting", "unreachable"] as const) {
      expect(describeLoadState(state)).toBeTruthy();
    }
  });
});

describe("loaded for this scope", () => {
  it("needs this mount's own load for this very scope, not only isLoaded", () => {
    expect(loadedForScope([loaded], scopeKey(["other"]), scope)).toBe(false);
    expect(loadedForScope([loaded], undefined, scope)).toBe(false);
    expect(loadedForScope([loaded, listing], scope, scope)).toBe(false);
    expect(loadedForScope([loaded, loaded], scope, scope)).toBe(true);
  });
});

describe("the kinds not known yet", () => {
  it("are every kind until this scope's load lands", () => {
    expect(
      unknownKinds(everyStore(loaded), [], listedFor(scopeKey(["other"])), scope),
    ).toHaveLength(6);
    expect(unknownKinds(everyStore(loaded), [], listedFor(scope), scope)).toEqual([]);
  });

  it("are judged kind by kind: one list that never lands leaves the others known", () => {
    const stores = { ...everyStore(loaded), Challenge: listing };
    const { Challenge: _, ...allButChallenge } = listedFor(scope);

    expect(unknownKinds(stores, [], allButChallenge, scope)).toEqual(["Challenge"]);
  });

  it("include a kind whose own list is still the last scope's", () => {
    expect(
      unknownKinds(
        everyStore(loaded),
        [],
        { ...listedFor(scope), Order: scopeKey(["other"]) },
        scope,
      ),
    ).toEqual(["Order"]);
  });

  it("are the refused ones, the unregistered ones and those still listing", () => {
    expect(unknownKinds(everyStore(loaded), ["Order"], listedFor(scope), scope)).toEqual(["Order"]);
    expect(unknownKinds(everyStore(undefined), [], listedFor(scope), scope)).toEqual(["Issuer"]);
    expect(unknownKinds(everyStore(listing), [], listedFor(scope), scope)).toEqual(["Issuer"]);
  });

  it("make an issuer whose list has not landed unknown, never missing", () => {
    const lagging: IssuerIndex = {
      issuers: [],
      clusterIssuers: issuerIndex().clusterIssuers,
      unlisted: new Set(unknownKinds(everyStore(listing), [], listedFor(scope), scope)),
    };
    const summary = summariseIssuers(lagging, certificates());
    const absentIssuers = (each: { kind: string }) => each.kind === "Issuer";

    expect(summary.missing.filter(absentIssuers)).toEqual([]);
    expect(summary.unknown.filter(absentIssuers).map((each) => each.name)).toEqual(
      expect.arrayContaining(["broken-ca", "flaky-ca"]),
    );
  });
});

describe("the rows a page shows", () => {
  it("are none while connecting, since a shared store may hold another scope's", () => {
    expect(rowsFor("connecting", certificates())).toEqual([]);
  });

  it("are what the stores hold otherwise", () => {
    expect(rowsFor("ready", certificates())).toHaveLength(certificates().length);
    expect(rowsFor("unreachable", certificates())).toHaveLength(certificates().length);
  });
});

describe("a page that stands on several lists", () => {
  it("is as far along as the furthest behind of them", () => {
    expect(worstOf("ready", "connecting")).toBe("connecting");
    expect(worstOf("connecting", "unreachable")).toBe("unreachable");
    expect(worstOf("not-installed", "ready")).toBe("not-installed");
    expect(worstOf("ready", "ready")).toBe("ready");
    expect(worstOf()).toBe("ready");
  });
});

describe("each tick of the loader", () => {
  const kinds: CertManagerKind[] = ["Certificate", "Issuer", "Challenge"];
  const none = new Set<CertManagerKind>();

  it("lists every kind at first", () => {
    expect(nextLoadStep(kinds, { listed: none, inFlight: none, attempts: 0 })).toEqual({
      load: kinds,
      done: false,
      gaveUp: false,
    });
  });

  it("lists again only the kinds that have not listed, never the whole group", () => {
    const step = nextLoadStep(kinds, {
      listed: new Set<CertManagerKind>(["Certificate", "Issuer"]),
      inFlight: none,
      attempts: 3,
    });

    expect(step.load).toEqual(["Challenge"]);
  });

  it("does not stack a second list on one still unanswered", () => {
    const step = nextLoadStep(kinds, {
      listed: new Set<CertManagerKind>(["Certificate"]),
      inFlight: new Set<CertManagerKind>(["Challenge"]),
      attempts: 3,
    });

    expect(step.load).toEqual(["Issuer"]);
    expect(step.done).toBe(false);
  });

  it("gives up when the clock runs out, even with a list that never answers", () => {
    const step = nextLoadStep(kinds, {
      listed: new Set<CertManagerKind>(["Certificate", "Issuer"]),
      inFlight: new Set<CertManagerKind>(["Challenge"]),
      attempts: MAX_LOAD_ATTEMPTS,
    });

    expect(step).toEqual({ load: [], done: false, gaveUp: true });
  });

  it("is done once every kind has listed, however late", () => {
    expect(
      nextLoadStep(kinds, { listed: new Set(kinds), inFlight: none, attempts: MAX_LOAD_ATTEMPTS }),
    ).toEqual({ load: [], done: true, gaveUp: false });
  });
});

describe("the kinds whose list was refused", () => {
  const kinds: CertManagerKind[] = ["Certificate", "Issuer", "ClusterIssuer"];

  it("gain a kind its list refuses", () => {
    expect(failedAfterList(kinds, new Set(), "Issuer", true).failed).toEqual(["Issuer"]);
  });

  it("lose a kind once a later list of it answers", () => {
    expect(failedAfterList(kinds, new Set(["Issuer"]), "Issuer", false).failed).toEqual([]);
  });

  it("keep a refused kind when another kind answers", () => {
    expect(failedAfterList(kinds, new Set(["Issuer"]), "Certificate", false).failed).toEqual([
      "Issuer",
    ]);
  });

  it("follow the kinds' order, not the order the lists were refused in", () => {
    const first = failedAfterList(kinds, new Set(), "ClusterIssuer", true);

    expect(failedAfterList(kinds, first.refused, "Certificate", true).failed).toEqual([
      "Certificate",
      "ClusterIssuer",
    ]);
  });
});
