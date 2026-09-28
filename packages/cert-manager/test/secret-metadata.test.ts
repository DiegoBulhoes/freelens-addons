import { describe, expect, it } from "vitest";

import {
  METADATA_ONLY,
  type PartialObjectMetadataList,
  TLS_SECRETS_PATH,
  tlsSecretsFrom,
} from "../src/renderer/api/secret-metadata";
import { managingCertificateOf } from "../src/renderer/api/unmanaged";
import { certificates } from "./fixtures";
import tlsSecretsJson from "./fixtures/tls-secrets.json";

/**
 * What the extension keeps of a Secret. The fixtures are already sanitised, so
 * the last-applied annotation — the one that carries values — is put back on a
 * copy to show it does not survive the mapping.
 */

const asMetadataList = (items: unknown[]): PartialObjectMetadataList => ({
  items: items.map((item) => ({ metadata: (item as { metadata: object }).metadata })),
});

const fixtureList = asMetadataList((tlsSecretsJson as { items: unknown[] }).items);

describe("asking for TLS Secrets", () => {
  it("asks for TLS Secrets only, and for their metadata only", () => {
    expect(decodeURIComponent(TLS_SECRETS_PATH)).toBe(
      "/api/v1/secrets?fieldSelector=type=kubernetes.io/tls",
    );
    expect(METADATA_ONLY).toContain("as=PartialObjectMetadataList");
  });
});

describe("what is kept of each", () => {
  const secrets = tlsSecretsFrom(fixtureList);

  it("keeps every Secret, by name and namespace, typed as TLS", () => {
    expect(secrets).toHaveLength(fixtureList.items?.length ?? 0);
    expect(secrets.every((secret) => secret.type === "kubernetes.io/tls")).toBe(true);
    expect(secrets.map((secret) => `${secret.getNs()}/${secret.getName()}`)).toContain(
      "demo/hand-made-tls",
    );
  });

  it("keeps cert-manager's annotations, which is what says who manages it", () => {
    const managed = secrets.find((secret) => secret.getName() === "web-tls");

    expect(managed && managingCertificateOf(managed, certificates())?.getName()).toBe("web-tls");
    expect(managed?.metadata.annotations?.["cert-manager.io/certificate-name"]).toBe("web-tls");
  });

  it("drops the last-applied annotation, which repeats the values", () => {
    const applied = asMetadataList([
      {
        metadata: {
          name: "hand-made-tls",
          namespace: "demo",
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": '{"stringData":{"tls.key":"..."}}',
            "cert-manager.io/issuer-name": "demo-ca",
          },
        },
      },
    ]);

    const [secret] = tlsSecretsFrom(applied);

    expect(JSON.stringify(secret?.metadata)).not.toContain("tls.key");
    expect(secret?.metadata.annotations).toEqual({ "cert-manager.io/issuer-name": "demo-ca" });
  });

  it("passes over an entry with no name, and an empty list", () => {
    expect(tlsSecretsFrom({ items: [{ metadata: {} }, {}] })).toEqual([]);
    expect(tlsSecretsFrom({})).toEqual([]);
  });

  it("treats a Secret without annotations as having none", () => {
    const [bare] = tlsSecretsFrom({ items: [{ metadata: { name: "bare", namespace: "demo" } }] });

    expect(bare?.metadata.annotations).toEqual({});
  });
});
