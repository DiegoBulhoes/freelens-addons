import { describe, expect, it } from "vitest";

import {
  getServedTls,
  getUnmanagedSecrets,
  isGap,
  managingCertificateOf,
  SERVED_STATES,
  secretSearchTexts,
  servedSearchTexts,
} from "../src/renderer/api/unmanaged";
import { certificateNamed, certificates, ingresses, tlsSecrets, variantOf } from "./fixtures";

// Besides the seed: the HTTP-01 solver Ingress (no TLS) and k3s's own serving certificate.

const secretNamed = (name: string) => {
  const found = tlsSecrets().find((each) => each.getName() === name);

  if (!found) throw new Error(`no TLS secret named ${name} in the fixtures`);

  return found;
};

describe("who manages a Secret", () => {
  it("is the Certificate that names it as its secretName", () => {
    expect(managingCertificateOf(secretNamed("web-tls"), certificates())?.getName()).toBe(
      "web-tls",
    );
  });

  it("is nobody for a Secret someone made by hand", () => {
    expect(managingCertificateOf(secretNamed("hand-made-tls"), certificates())).toBeUndefined();
  });

  it("falls back to cert-manager's annotation when the Certificate writes elsewhere now", () => {
    const moved = certificates().map((certificate) =>
      certificate.getName() === "managed-tls"
        ? variantOf(certificate, (raw) => {
            raw.spec.secretName = "managed-tls-v2";
          })
        : certificate,
    );

    expect(managingCertificateOf(secretNamed("managed-tls"), moved)?.getName()).toBe("managed-tls");
  });

  it("is nobody once the Certificate the annotation names is gone", () => {
    const others = certificates().filter((each) => each.getName() !== "managed-tls");

    expect(managingCertificateOf(secretNamed("managed-tls"), others)).toBeUndefined();
  });
});

describe("what the Ingresses serve", () => {
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());

  it("reads every TLS entry, and passes over the solver Ingress that has none", () => {
    expect(served.map((each) => each.ingress).sort()).toEqual([
      "managed",
      "missing-secret",
      "unmanaged",
    ]);
  });

  it("says which are managed, which nothing renews, and which are not there", () => {
    const state = Object.fromEntries(served.map((each) => [each.ingress, each.state]));

    expect(state).toEqual({
      managed: "managed",
      unmanaged: "unmanaged",
      "missing-secret": "missing",
    });
  });

  it("puts the gaps first", () => {
    expect(served.map((each) => each.state)).toEqual(["unmanaged", "missing", "managed"]);
  });

  it("names the Certificate behind a managed one, and the hosts it covers", () => {
    const managed = served.find((each) => each.state === "managed");

    expect(managed).toMatchObject({ certificate: "managed-tls", hosts: ["managed.demo.test"] });
  });

  it("calls a Secret a Certificate is about to write pending, not missing", () => {
    const writer = variantOf(certificateNamed("never-issued"), (raw) => {
      raw.spec.secretName = "nowhere-tls";
    });

    const withWriter = getServedTls(ingresses(), tlsSecrets(), [...certificates(), writer]);

    expect(withWriter.find((each) => each.ingress === "missing-secret")).toMatchObject({
      state: "pending",
      certificate: "never-issued",
    });
  });

  it("passes over a TLS entry with no Secret, which is the controller's default", () => {
    const defaulted = ingresses().map((ingress) =>
      ingress.getName() === "unmanaged"
        ? variantOf(ingress, (raw) => {
            delete raw.spec.tls[0].secretName;
          })
        : ingress,
    );

    expect(
      getServedTls(defaulted, tlsSecrets(), certificates()).map((each) => each.ingress),
    ).not.toContain("unmanaged");
  });

  it("reads an entry without hosts as covering none", () => {
    const hostless = ingresses().map((ingress) =>
      ingress.getName() === "unmanaged"
        ? variantOf(ingress, (raw) => {
            delete raw.spec.tls[0].hosts;
          })
        : ingress,
    );

    expect(
      getServedTls(hostless, tlsSecrets(), certificates()).find(
        (each) => each.ingress === "unmanaged",
      )?.hosts,
    ).toEqual([]);
  });
});

describe("TLS Secrets no Certificate writes", () => {
  it("lists them all, served or not, the other controllers' included", () => {
    const unmanaged = getUnmanagedSecrets(tlsSecrets(), certificates()).map(
      (each) => `${each.getNs()}/${each.getName()}`,
    );

    expect(unmanaged).toEqual([
      "demo/hand-made-tls",
      "demo/leftover-tls",
      "kube-system/k3s-serving",
    ]);
  });

  it("does not list a Secret that is not a TLS Secret", () => {
    const opaque = variantOf(secretNamed("leftover-tls"), (raw) => {
      raw.type = "Opaque";
    });

    expect(getUnmanagedSecrets([opaque], certificates())).toEqual([]);
  });
});

describe("how the served list reads", () => {
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());

  it("counts as a gap what nothing renews and what nothing will create", () => {
    expect(served.filter(isGap).map((each) => each.ingress)).toEqual([
      "unmanaged",
      "missing-secret",
    ]);
  });

  it("tones a gap critical, one being issued a warning, a managed one fine", () => {
    expect(SERVED_STATES.unmanaged.tone).toBe("critical");
    expect(SERVED_STATES.missing.tone).toBe("critical");
    expect(SERVED_STATES.pending.tone).toBe("warning");
    expect(SERVED_STATES.managed.tone).toBe("ok");
  });

  it("searches everything a row shows", () => {
    const managed = served.find((each) => each.state === "managed");

    expect(managed && servedSearchTexts(managed)).toEqual([
      "Managed",
      "managed",
      "demo",
      "managed-tls",
      "managed-tls",
      "managed.demo.test",
    ]);
  });

  it("searches a Secret by its name and namespace", () => {
    const [first] = getUnmanagedSecrets(tlsSecrets(), certificates());

    expect(first && secretSearchTexts(first)).toEqual([first?.getName(), first?.getNs()]);
  });
});
