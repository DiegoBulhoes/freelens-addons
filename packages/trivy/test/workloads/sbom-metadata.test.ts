import { afterEach, describe, expect, it, vi } from "vitest";
import { hostListOf } from "../../src/renderer/api/shared/host-links";
import {
  READ_SLOTS,
  READ_TIMEOUT_MS,
  settleInSlots,
  withTimeout,
} from "../../src/renderer/api/shared/read-timeout";
import {
  hasGivenUp,
  MAX_LOAD_ATTEMPTS,
  nextListDelay,
  RELIST_MS,
  RETRY_DELAY_MS,
} from "../../src/renderer/api/shared/retry";
import { subjectKey, subjectOf } from "../../src/renderer/api/shared/subjects";
import {
  mergeSbomListings,
  type PartialObjectMetadataList,
  refusedIn,
  sbomListPath,
  sbomSubjectsFrom,
  sbomSubjectsIn,
  settledSbomListings,
} from "../../src/renderer/api/workloads/sbom-metadata";
import sbomJson from "../fixtures/sbom-reports.json";
import { pods, sbomReports } from "../support/fixtures";

// The exported SBOMs, cut to what a metadata-only list returns: the bodies are what it saves.
function metadataOf(namespace?: string): PartialObjectMetadataList {
  const items = (sbomJson as { items: { metadata: { namespace?: string } }[] }).items;

  return {
    items: items
      .filter((item) => namespace === undefined || item.metadata.namespace === namespace)
      .map((item) => ({ metadata: item.metadata as never })),
  };
}

const keysOf = (objects: Parameters<typeof subjectOf>[0][]) =>
  objects
    .map(subjectOf)
    .filter((subject) => subject !== undefined)
    .map(subjectKey)
    .sort();

describe("reading SBOMs as metadata only", () => {
  it("finds the same subjects as the full reports, from their metadata alone", () => {
    const subjects = sbomSubjectsFrom(metadataOf());

    expect(subjects.length).toBeGreaterThan(0);
    expect(keysOf(subjects)).toEqual(keysOf(sbomReports()));
  });

  it("keeps each SBOM's namespace, for the namespace selector", () => {
    const [first] = sbomSubjectsFrom(metadataOf("demo"));

    expect(first?.getNs()).toBe("demo");
  });

  it("skips an item with no name, and a list with no items", () => {
    expect(sbomSubjectsFrom({ items: [{ metadata: {} }, {}] })).toEqual([]);
    expect(sbomSubjectsFrom({})).toEqual([]);
  });

  it("reads a subject that carries no owner or label at all as none", () => {
    const [bare] = sbomSubjectsFrom({ items: [{ metadata: { name: "x", namespace: "demo" } }] });

    expect(bare?.getLabels()).toEqual([]);
    expect(bare?.getOwnerRefs()).toEqual([]);
    expect(bare && subjectOf(bare)).toBeUndefined();
  });

  it("lists one namespace's SBOMs through the API", () => {
    expect(sbomListPath("demo")).toBe(
      "/apis/aquasecurity.github.io/v1alpha1/namespaces/demo/sbomreports",
    );
  });
});

describe("listing SBOMs namespace by namespace", () => {
  const refused = new Error("403 Forbidden");

  it("keeps the namespaces that answered when one is refused", () => {
    const listed = settledSbomListings(
      ["argocd", "demo"],
      [
        { status: "fulfilled", value: metadataOf("argocd") },
        { status: "rejected", reason: refused },
      ],
    );

    expect(sbomSubjectsIn(listed, ["argocd", "demo"]).length).toBeGreaterThan(0);
    expect(refusedIn(listed, ["argocd", "demo"])).toEqual(["demo"]);
    expect(listed.get("demo")).toEqual({ error: "403 Forbidden" });
  });

  it("names a refusal that is not an Error, and one that never settled", () => {
    const results: PromiseSettledResult<PartialObjectMetadataList>[] = [
      { status: "rejected", reason: "gone" },
    ];
    const listed = settledSbomListings(["argocd", "demo"], results);

    expect(listed.get("argocd")).toEqual({ error: "gone" });
    expect(listed.get("demo")).toEqual({ error: "not listed" });
  });

  const listedDemo = () =>
    settledSbomListings(["demo"], [{ status: "fulfilled", value: metadataOf("demo") }]);

  it("keeps a namespace's last listing when a later one is refused", () => {
    const first = listedDemo();
    const second = settledSbomListings(["demo"], [{ status: "rejected", reason: refused }]);
    const merged = mergeSbomListings(first, second);

    expect(refusedIn(merged, ["demo"])).toEqual([]);
    expect(sbomSubjectsIn(merged, ["demo"])).toHaveLength(sbomSubjectsIn(first, ["demo"]).length);
  });

  it("takes a fresh listing over an old one, and a refusal where nothing was listed", () => {
    const empty = settledSbomListings(["demo"], [{ status: "fulfilled", value: {} }]);
    const full = listedDemo();
    const refusal = settledSbomListings(["argocd"], [{ status: "rejected", reason: refused }]);

    expect(sbomSubjectsIn(mergeSbomListings(full, empty), ["demo"])).toEqual([]);
    expect(refusedIn(mergeSbomListings(full, refusal), ["argocd", "demo"])).toEqual(["argocd"]);
  });

  it("returns nothing for a namespace not listed yet, without calling it refused", () => {
    expect(sbomSubjectsIn(new Map(), ["demo"])).toEqual([]);
    expect(refusedIn(new Map(), ["demo"])).toEqual([]);
  });
});

describe("pacing the reads", () => {
  it("retries a refused read soon, and gives up after the last attempt", () => {
    expect(nextListDelay(1)).toBe(RETRY_DELAY_MS);
    expect(hasGivenUp(MAX_LOAD_ATTEMPTS - 1)).toBe(false);
    expect(hasGivenUp(MAX_LOAD_ATTEMPTS)).toBe(true);
    expect(nextListDelay(MAX_LOAD_ATTEMPTS)).toBe(RELIST_MS);
  });

  it("lists again slowly once a read answers", () => {
    expect(nextListDelay(0)).toBe(RELIST_MS);
  });
});

describe("bounding a read", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes on what the read returns", async () => {
    await expect(withTimeout(async () => "listed")).resolves.toBe("listed");
  });

  it("rejects and aborts a read that does not answer in time", async () => {
    vi.useFakeTimers();

    let signal: AbortSignal | undefined;
    const hung = withTimeout((given) => {
      signal = given;

      return new Promise<never>(() => undefined);
    });
    const outcome = expect(hung).rejects.toThrow(`No answer in ${READ_TIMEOUT_MS / 1000}s`);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });
});

describe("reading many namespaces a few at a time", () => {
  const namespaces = () =>
    [...new Set(sbomReports().map((report) => report.getNs() ?? ""))].filter(Boolean);

  it("never has more reads under way than it has slots", async () => {
    const scope = namespaces();
    let running = 0;
    let most = 0;
    const read = async (namespace: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;

      return namespace;
    };

    expect(scope.length).toBeGreaterThan(2);

    const results = await settleInSlots(scope, read, 2);

    expect(most).toBe(2);
    expect(results.map((each) => each.status === "fulfilled" && each.value)).toEqual(scope);
  });

  it("keeps a refusal in its namespace's place and reads the rest", async () => {
    const scope = namespaces();
    const [refused] = scope;
    const results = await settleInSlots(scope, async (namespace) => {
      if (namespace === refused) throw new Error("403 Forbidden");

      return namespace;
    });

    expect(results[0]).toEqual({ status: "rejected", reason: new Error("403 Forbidden") });
    expect(results.slice(1).every((each) => each.status === "fulfilled")).toBe(true);
    expect(results).toHaveLength(scope.length);
  });

  it("reads nothing for no namespace, and holds the cluster's namespaces to its slots", async () => {
    const scope = namespaces();
    let running = 0;
    let most = 0;

    expect(await settleInSlots([], async () => "never")).toEqual([]);
    expect(scope.length).toBeGreaterThan(READ_SLOTS);

    await settleInSlots(scope, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    });

    expect(most).toBe(READ_SLOTS);
  });
});

describe("linking to the host's lists", () => {
  it("narrows the list of the subject's kind to its name", () => {
    expect(hostListOf("Deployment", "web")).toBe("/deployments?search=web");
    expect(hostListOf("ReplicaSet", "web-794cc4c7f4")).toBe("/replicasets?search=web-794cc4c7f4");
  });

  it("narrows the Pods list to a pod the drawer lists", () => {
    const [pod] = pods();

    if (!pod) throw new Error("the pod fixtures are gone");
    expect(hostListOf("Pod", pod.getName())).toBe(
      `/pods?search=${encodeURIComponent(pod.getName())}`,
    );
  });

  it("links nowhere for a kind the host lists nowhere", () => {
    expect(hostListOf("ReplicationController", "old")).toBeUndefined();
  });
});
