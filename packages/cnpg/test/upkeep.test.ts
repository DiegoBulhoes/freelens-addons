import { describe, expect, it } from "vitest";

import {
  certificateExpiries,
  clusterEvents,
  describeExpiry,
  eventTime,
  parseOperatorTime,
  RENEWAL_WINDOW_MS,
  upkeepIssues,
  volumeProblems,
} from "../src/renderer/api/upkeep";
import { backups, clusterNamed, events, fixtureNow, variantOf } from "./fixtures";

const now = fixtureNow();
const DAY = 24 * 60 * 60 * 1000;

const expiringIn = (ms: number) =>
  variantOf(clusterNamed("orders-db"), (raw) => {
    const at = new Date(now + ms)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " +0000 UTC");

    raw.status.certificates.expirations["orders-db-server"] = at;
  });

describe("the certificates the operator manages", () => {
  it("reads the operator's time format, and nothing else", () => {
    expect(parseOperatorTime("2027-01-01 21:37:01 +0000 UTC")).toBe(
      Date.parse("2027-01-01T21:37:01Z"),
    );
    expect(parseOperatorTime("next tuesday")).toBeUndefined();
    expect(parseOperatorTime("2027-13-45 99:99:99 +0000 UTC")).toBeUndefined();
  });

  it("lists each one, soonest first, fine while outside the renewal window", () => {
    const expiries = certificateExpiries(clusterNamed("orders-db"), now);

    expect(expiries.map((each) => each.secret)).toEqual(
      expect.arrayContaining(["orders-db-ca", "orders-db-replication", "orders-db-server"]),
    );
    expect(expiries.every((each) => each.tone === "ok")).toBe(true);
  });

  it("warns inside the renewal window, and is critical once expired", () => {
    const soon = certificateExpiries(expiringIn(RENEWAL_WINDOW_MS - DAY), now)[0];
    const gone = certificateExpiries(expiringIn(-DAY), now)[0];

    expect(soon).toMatchObject({ secret: "orders-db-server", tone: "warning" });
    expect(gone).toMatchObject({ secret: "orders-db-server", tone: "critical" });
    expect(describeExpiry(soon ?? { secret: "", tone: "ok" }, now)).toBe("Expires in 6 days");
    expect(describeExpiry(gone ?? { secret: "", tone: "ok" }, now)).toBe("Expired 24h ago");
  });

  it("says today, a single day, and when it cannot read the date", () => {
    expect(describeExpiry({ secret: "x", tone: "warning", expiresAt: now + 3_600_000 }, now)).toBe(
      "Expires today",
    );
    expect(
      describeExpiry({ secret: "x", tone: "warning", expiresAt: now + DAY + 60_000 }, now),
    ).toBe("Expires in 1 day");

    const garbled = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.certificates.expirations = { "orders-db-ca": "soon" };
    });
    const [unreadable] = certificateExpiries(garbled, now);

    expect(unreadable?.tone).toBe("info");
    expect(describeExpiry(unreadable ?? { secret: "", tone: "info" }, now)).toBe(
      "Expiry unreadable",
    );
  });

  it("has none before the operator reports them", () => {
    const fresh = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.certificates = undefined;
    });

    expect(certificateExpiries(fresh, now)).toEqual([]);
  });
});

describe("a cluster's volumes", () => {
  it("names a volume still initializing, as information", () => {
    expect(volumeProblems(clusterNamed("analytics-db"))).toEqual([
      expect.objectContaining({
        pvc: "analytics-db-1",
        verdict: expect.objectContaining({ tone: "info" }),
      }),
    ]);
  });

  it("does not call a hibernated cluster's kept volumes dangling", () => {
    const reports = clusterNamed("reports-db");

    expect(reports.status?.danglingPVC).toEqual(["reports-db-1"]);
    expect(volumeProblems(reports)).toEqual([]);
  });

  it("warns of a dangling volume and is critical about an unusable one", () => {
    const broken = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.danglingPVC = ["orders-db-4"];
      raw.status.unusablePVC = ["orders-db-5"];
    });

    expect(volumeProblems(broken).map((each) => [each.pvc, each.verdict.tone])).toEqual([
      ["orders-db-5", "critical"],
      ["orders-db-4", "warning"],
    ]);
  });

  it("finds nothing wrong with a healthy cluster's volumes", () => {
    expect(volumeProblems(clusterNamed("orders-db"))).toEqual([]);
  });
});

describe("what the attention list adds", () => {
  it("adds expiring certificates and broken volumes, not volumes being initialized", () => {
    const both = variantOf(expiringIn(-DAY), (raw) => {
      raw.status.unusablePVC = ["orders-db-5"];
    });

    expect(upkeepIssues(both, now).map((issue) => issue.label)).toEqual([
      "Certificate expired",
      "Unusable volume",
    ]);
    expect(upkeepIssues(expiringIn(DAY * 2), now)[0]?.label).toBe("Certificate expiring");
    expect(upkeepIssues(clusterNamed("analytics-db"), now)).toEqual([]);
  });
});

describe("a cluster's warnings", () => {
  it("collects the cluster's own, its instances', volumes' and backups', newest first", () => {
    const found = clusterEvents(events(), clusterNamed("analytics-db"), backups());

    expect(found.map((event) => event.involvedObject.kind).sort()).toEqual(
      expect.arrayContaining(["PersistentVolumeClaim", "Pod"]),
    );
    expect(found.every((event) => event.getNs() === "databases")).toBe(true);

    const times = found.map((event) => Date.parse(eventTime(event) ?? ""));

    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("includes its backups' events but not another cluster's, nor its poolers'", () => {
    const [warning] = events().filter((event) => event.getNs() === "databases");
    if (!warning) throw new Error("no warning in the databases namespace in the fixtures");

    const about = (kind: string, name: string) =>
      variantOf(warning, (raw) => {
        raw.metadata.name = `${name}.event`;
        raw.involvedObject = { kind, name };
      });
    const ownBackup = backups().find((backup) => backup.spec.cluster.name === "orders-db");
    const otherBackup = backups().find((backup) => backup.spec.cluster.name !== "orders-db");
    if (!ownBackup || !otherBackup) throw new Error("the fixtures need backups of two clusters");

    const found = clusterEvents(
      [
        about("Backup", ownBackup.getName()),
        about("Backup", otherBackup.getName()),
        about("Pod", "orders-rw-6757c6566-7fvxf"),
      ],
      clusterNamed("orders-db"),
      backups(),
    );

    expect(found.map((event) => event.involvedObject.name)).toEqual([ownBackup.getName()]);
  });

  it("matches instances by serial, so a longer cluster name is not taken for one", () => {
    const shortName = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.metadata.name = "orders";
    });

    expect(clusterEvents(events(), shortName, backups())).toEqual([]);
  });

  it("ignores normal events and other namespaces, and dates an event however it is stamped", () => {
    const [first] = clusterEvents(events(), clusterNamed("analytics-db"), backups());
    if (!first) throw new Error("no analytics-db warning in the fixtures");

    const normal = variantOf(first, (raw) => {
      raw.type = "Normal";
    });
    const elsewhere = variantOf(first, (raw) => {
      raw.metadata.namespace = "default";
    });
    const stampedOnce = variantOf(first, (raw) => {
      raw.lastTimestamp = undefined;
      raw.eventTime = "2026-01-01T00:00:00Z";
    });
    const unstamped = variantOf(first, (raw) => {
      raw.lastTimestamp = undefined;
      raw.eventTime = undefined;
      raw.metadata.creationTimestamp = undefined;
    });

    expect(clusterEvents([normal, elsewhere], clusterNamed("analytics-db"), [])).toEqual([]);
    expect(eventTime(stampedOnce)).toBe("2026-01-01T00:00:00Z");
    expect(clusterEvents([unstamped, stampedOnce], clusterNamed("analytics-db"), [])).toHaveLength(
      2,
    );

    const other = variantOf(first, (raw) => {
      raw.involvedObject = { kind: "Service", name: "analytics-db-1" };
    });
    const ownCluster = variantOf(first, (raw) => {
      raw.involvedObject = { kind: "Cluster", name: "analytics-db" };
    });

    expect(clusterEvents([other, ownCluster], clusterNamed("analytics-db"), [])).toEqual([
      ownCluster,
    ]);
  });
});
