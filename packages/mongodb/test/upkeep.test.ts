import { describe, expect, it } from "vitest";

import {
  connectionUrl,
  describeTls,
  eventTime,
  replicaSetEvents,
  secretNamesFrom,
  securityOf,
  tlsOf,
  usersOf,
} from "../src/renderer/api/upkeep";
import { events, named, replicaSets, secrets } from "./fixtures";

describe("a cluster's warnings", () => {
  it("keeps its volume and scheduling warnings, newest first", () => {
    const found = replicaSetEvents(events(), named(replicaSets(), "legacy-rs"));

    expect(found.map((each) => each.reason)).toContain("ProvisioningFailed");
    expect(found.every((each) => /legacy-rs/.test(each.involvedObject.name))).toBe(true);
    const times = found.map((each) => eventTime(each) ?? "");
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("drops readiness-probe failures, which only repeat the agent's log", () => {
    const raw = events().filter((each) => /Readiness probe/.test(each.message ?? ""));

    expect(raw.length).toBeGreaterThan(0);
    for (const rs of replicaSets()) {
      expect(
        replicaSetEvents(events(), rs).some((each) => /Readiness probe/.test(each.message ?? "")),
      ).toBe(false);
    }
  });

  it("does not take another set's warnings for its own", () => {
    const own = replicaSetEvents(events(), named(replicaSets(), "sessions-rs"));

    expect(own.every((each) => each.involvedObject.name.includes("sessions-rs"))).toBe(true);
    expect(replicaSetEvents(events(), named(replicaSets(), "catalog-rs"))).toEqual([]);
  });

  it("falls back to eventTime when an event has no lastTimestamp", () => {
    expect(
      eventTime({
        eventTime: "2026-01-01T00:00:00Z",
        involvedObject: { kind: "Pod", name: "x" },
      } as never),
    ).toBe("2026-01-01T00:00:00Z");
  });
});

describe("its users", () => {
  it("knows which password Secrets exist, and where each connection string is", () => {
    expect(usersOf(named(replicaSets(), "catalog-rs"), secrets())).toEqual([
      expect.objectContaining({
        hasPassword: true,
        connectionSecret: "catalog-rs-admin-catalog-admin",
      }),
    ]);
    expect(usersOf(named(replicaSets(), "reporting-rs"), secrets())[0]?.hasPassword).toBe(false);
  });

  it("raises no alarm before the Secrets are listed", () => {
    expect(usersOf(named(replicaSets(), "reporting-rs"), undefined)[0]?.hasPassword).toBe(true);
    expect(usersOf(named(replicaSets(), "legacy-rs"), secrets())).toEqual([]);
  });
});

describe("its security", () => {
  it("states authentication and metrics", () => {
    expect(securityOf(named(replicaSets(), "catalog-rs"))).toEqual([
      { label: "Authentication", value: "SCRAM" },
      { label: "Metrics", value: "Off" },
    ]);
  });

  it("names the metrics port when they are on", () => {
    const rs = named(replicaSets(), "catalog-rs");

    expect(
      securityOf({ ...rs, spec: { ...rs.spec, prometheus: { port: 9216 } } } as never)[1]?.value,
    ).toBe("Prometheus on port 9216");
  });
});

describe("its TLS", () => {
  it("names the certificate Secret, the CA, and that cert-manager issued it", () => {
    const view = tlsOf(named(replicaSets(), "secure-rs"), secrets());

    expect(view).toEqual({
      enabled: true,
      optional: false,
      secret: "secure-rs-tls",
      ca: "Secret secure-rs-tls",
      certManager: { certificate: "secure-rs-tls", issuer: "demo-ca", issuerKind: "ClusterIssuer" },
    });
    expect(describeTls(view)).toBe(
      "On · Secret secure-rs-tls · issued by cert-manager (Certificate secure-rs-tls, ClusterIssuer demo-ca)",
    );
  });

  it("does not claim cert-manager before the Secrets are listed, nor for a Secret it did not issue", () => {
    const rs = named(replicaSets(), "secure-rs");

    expect(tlsOf(rs, undefined).certManager).toBeUndefined();
    expect(
      tlsOf(
        rs,
        secrets().map((each) => ({ metadata: { ...each.metadata, annotations: {} } })),
      ).certManager,
    ).toBeUndefined();
  });

  it("says Off without TLS, and reads a CA from a ConfigMap", () => {
    const rs = named(replicaSets(), "secure-rs");
    const viaMap = {
      ...rs,
      spec: {
        ...rs.spec,
        security: { tls: { enabled: true, optional: true, caConfigMapRef: { name: "ca" } } },
      },
    };

    expect(describeTls(tlsOf(named(replicaSets(), "catalog-rs"), secrets()))).toBe("Off");
    expect(tlsOf(viaMap as never, secrets())).toMatchObject({
      ca: "ConfigMap ca",
      secret: undefined,
    });
    expect(describeTls(tlsOf(viaMap as never, secrets()))).toBe("On, optional");
  });

  it("asks for TLS in the connection URL when the cluster requires it", () => {
    expect(connectionUrl(named(replicaSets(), "secure-rs"))).toBe(
      "mongodb://secure-rs-0.secure-rs-svc.mongodb.svc.cluster.local:27017/?replicaSet=secure-rs&tls=true",
    );
    expect(connectionUrl(named(replicaSets(), "catalog-rs"))).toMatch(/\?replicaSet=catalog-rs$/);
    expect(connectionUrl(named(replicaSets(), "legacy-rs"))).toBeUndefined();
  });
});

describe("listing Secrets", () => {
  it("keeps cert-manager's annotations and drops the rest", () => {
    expect(
      secretNamesFrom({
        items: [
          {
            metadata: {
              name: "t",
              annotations: {
                "cert-manager.io/certificate-name": "t",
                "kubectl.kubernetes.io/last-applied-configuration": '{"data":{}}',
              },
            },
          },
        ],
      })[0]?.metadata.annotations,
    ).toEqual({ "cert-manager.io/certificate-name": "t" });
  });

  it("keeps names and namespaces only", () => {
    expect(
      secretNamesFrom({
        items: [{ metadata: { name: "a", namespace: "n" } }, { metadata: {} }, {}],
      }),
    ).toEqual([{ metadata: { name: "a", namespace: "n", annotations: {} } }]);
    expect(secretNamesFrom({})).toEqual([]);
  });
});
