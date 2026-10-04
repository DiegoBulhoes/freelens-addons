import { describe, expect, it } from "vitest";

import {
  connectionUrls,
  describeTls,
  eventsOf,
  eventTime,
  passwordCommand,
  secretNamesFrom,
  tlsOf,
} from "../src/renderer/api/upkeep";
import { events, named, secrets } from "./fixtures";

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
    const view = tlsOf(named("sessions"), secrets());

    expect(view).toEqual({
      enabled: true,
      secret: "sessions-tls",
      certManager: { certificate: "sessions-tls", issuer: "demo-ca", issuerKind: "ClusterIssuer" },
    });
    expect(describeTls(view)).toBe(
      "On · Secret sessions-tls · issued by cert-manager (Certificate sessions-tls, ClusterIssuer demo-ca)",
    );
  });

  it("claims nothing before the Secrets are listed, and says Off without TLS", () => {
    expect(tlsOf(named("sessions"), undefined)).toEqual({
      enabled: true,
      secret: "sessions-tls",
      certManager: undefined,
    });
    expect(describeTls(tlsOf(named("sessions"), undefined))).toBe("On · Secret sessions-tls");
    expect(describeTls(tlsOf(named("cache"), secrets()))).toBe("Off");
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

    expect(tlsOf(named("sessions"), listed).certManager).toEqual({
      certificate: "x",
      issuer: "",
      issuerKind: "Issuer",
    });
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
