import { describe, expect, it } from "vitest";

import {
  anyRefused,
  connectionUrls,
  describeTlsIssuer,
  eventsOf,
  eventTime,
  mergeListings,
  nextWarnings,
  passwordCommand,
  type SecretListing,
  secretNamesFrom,
  tlsOf,
  warningsNote,
} from "../../src/renderer/api/objects/upkeep";
import { events, named, secretListings, secrets } from "../support/fixtures";

describe("an object's warnings", () => {
  it("keeps its pods' and volumes' warnings, newest first", () => {
    const found = eventsOf(events(), named("legacy-store"));

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((each) => each.involvedObject.name.includes("legacy-store"))).toBe(true);
    const times = found.map((each) => eventTime(each) ?? "");
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("drops readiness-probe failures and keeps others' warnings out", () => {
    for (const name of ["cache", "shards", "sessions", "cache-sentinel"]) {
      expect(
        eventsOf(events(), named(name)).some((each) => /Readiness probe/.test(each.message ?? "")),
      ).toBe(false);
    }
    expect(
      eventsOf(events(), named("cache")).every(
        (each) => !each.involvedObject.name.startsWith("broken-cache"),
      ),
    ).toBe(true);
  });

  it("keeps another namespace's warnings out, though the names match", () => {
    const legacy = named("legacy-store");
    const elsewhere = eventsOf(events(), legacy).map((each) => ({
      ...each,
      metadata: { ...each.metadata, namespace: "elsewhere" },
    }));

    expect(elsewhere.length).toBeGreaterThan(0);
    expect(eventsOf(elsewhere, legacy)).toEqual([]);
  });

  it("falls back to eventTime", () => {
    expect(
      eventTime({
        eventTime: "2026-01-01T00:00:00Z",
        involvedObject: { kind: "Pod", name: "x" },
      } as never),
    ).toBe("2026-01-01T00:00:00Z");
  });
});

describe("TLS", () => {
  it("names the Secret and that cert-manager issued it", () => {
    const view = tlsOf(named("sessions"), secretListings());

    expect(view).toEqual({
      enabled: true,
      secret: "sessions-tls",
      certManager: { certificate: "sessions-tls", issuer: "demo-ca", issuerKind: "ClusterIssuer" },
    });
    expect(describeTlsIssuer(view)).toBe(
      " · issued by cert-manager (Certificate sessions-tls, ClusterIssuer demo-ca)",
    );
  });

  it("claims nothing before the Secrets are listed, and says Off without TLS", () => {
    expect(tlsOf(named("sessions"), undefined)).toEqual({
      enabled: true,
      secret: "sessions-tls",
      certManager: undefined,
    });
    expect(describeTlsIssuer(tlsOf(named("sessions"), new Map()))).toBe("");
    expect(tlsOf(named("cache"), secretListings())).toEqual({ enabled: false });
  });

  it("says its issuer could not be read when its namespace refused the list", () => {
    const view = tlsOf(
      named("sessions"),
      new Map<string, SecretListing>([["redis", { error: "403 Forbidden" }]]),
    );

    expect(view).toEqual({ enabled: true, secret: "sessions-tls", unread: "403 Forbidden" });
    expect(describeTlsIssuer(view)).toBe(" · its issuer could not be read (403 Forbidden)");
  });

  it("judges only the object's own namespace, and keeps names a failed re-list would drop", () => {
    const refusedElsewhere = new Map<string, SecretListing>([
      ...secretListings(),
      ["other", { error: "403 Forbidden" }],
    ]);

    expect(tlsOf(named("sessions"), refusedElsewhere).certManager?.issuer).toBe("demo-ca");
    expect(anyRefused(refusedElsewhere)).toBe(true);
    expect(anyRefused(secretListings())).toBe(false);

    const failed = new Map<string, SecretListing>([["redis", { error: "timeout" }]]);

    expect(mergeListings(secretListings(), failed).get("redis")).toEqual(secrets());
    expect(mergeListings(undefined, failed).get("redis")).toEqual({ error: "timeout" });
    expect(mergeListings(failed, secretListings()).get("redis")).toEqual(secrets());
  });

  it("falls back to Issuer when the kind annotation is empty", () => {
    const listed = secrets().map((each) =>
      each.metadata.name === "sessions-tls"
        ? {
            metadata: {
              ...each.metadata,
              annotations: { "cert-manager.io/certificate-name": "x" },
            },
          }
        : each,
    );

    expect(tlsOf(named("sessions"), new Map([["redis", listed]])).certManager).toEqual({
      certificate: "x",
      issuer: "",
      issuerKind: "Issuer",
    });
  });
});

describe("the drawer's warnings, read while it is open", () => {
  it("says it is reading, that the read was refused, or that there is none", () => {
    expect(warningsNote(undefined, 0)).toBe("Reading its namespace's warning events…");
    expect(warningsNote({ error: "403 Forbidden" }, 0)).toBe(
      "Could not read its namespace's events (403 Forbidden).",
    );
    expect(warningsNote({ events: events() }, 0)).toBe(
      "No warning events for it, its pods or its volumes.",
    );
    expect(warningsNote({ events: events() }, 2)).toBeUndefined();
  });

  it("keeps the events read before when a re-list fails", () => {
    const read = { events: events() };

    expect(nextWarnings(read, { error: "timeout" })).toBe(read);
    expect(nextWarnings(undefined, { error: "timeout" })).toEqual({ error: "timeout" });
    expect(nextWarnings({ error: "timeout" }, read)).toBe(read);
  });
});

describe("connecting", () => {
  it("offers each kind's service, rediss with TLS, the sentinel port for sentinels", () => {
    expect(connectionUrls(named("cache"))).toEqual([
      { label: "Master (read-write)", url: "redis://cache-master.redis.svc:6379" },
      { label: "Replicas (read-only)", url: "redis://cache-replica.redis.svc:6379" },
    ]);
    expect(connectionUrls(named("shards"))[0]?.url).toBe("redis://shards-leader.redis.svc:6379");
    expect(connectionUrls(named("cache-sentinel"))[0]?.url).toBe(
      "redis://cache-sentinel-sentinel.redis.svc:26379",
    );
    expect(connectionUrls(named("sessions"))[0]?.url).toBe("rediss://sessions.redis.svc:6379");
  });

  it("reads the password in the terminal, from the Secret and key the object names", () => {
    expect(passwordCommand(named("cache"))).toBe(
      "kubectl get secret -n redis redis-password -o jsonpath='{.data.password}' | base64 -d",
    );
    expect(passwordCommand(named("legacy-store"))).toBeUndefined();
  });
});

describe("listing Secrets", () => {
  it("keeps names and cert-manager's annotations only", () => {
    expect(
      secretNamesFrom({
        items: [
          {
            metadata: {
              name: "s",
              namespace: "n",
              annotations: {
                "cert-manager.io/issuer-name": "ca",
                "kubectl.kubernetes.io/last-applied-configuration": "{}",
              },
            },
          },
          { metadata: {} },
        ],
      }),
    ).toEqual([
      {
        metadata: {
          name: "s",
          namespace: "n",
          annotations: { "cert-manager.io/issuer-name": "ca" },
        },
      },
    ]);
    expect(secretNamesFrom({})).toEqual([]);
  });
});
