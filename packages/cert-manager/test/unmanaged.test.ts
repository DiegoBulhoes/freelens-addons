import { describe, expect, it } from "vitest";

import {
  annotationsOfInterest,
  getServedTls,
  getUnmanagedSecrets,
  ingressesServing,
  isGap,
  managingCertificateOf,
  SERVED_STATES,
  secretSearchTexts,
  secretVerdict,
  servedSearchTexts,
  servedVerdict,
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

describe("why a served entry is in its state", () => {
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());
  const entryOf = (ingress: string) => {
    const found = served.find((each) => each.ingress === ingress);

    if (!found) throw new Error(`no served entry for ${ingress}`);

    return found;
  };

  it("says nothing renews a Secret no Certificate writes", () => {
    expect(servedVerdict(entryOf("unmanaged"))).toEqual({
      tone: "critical",
      label: "No Certificate",
      reason:
        "No Certificate writes Secret hand-made-tls. Nothing renews it: it is served until it expires.",
    });
  });

  it("says a missing Secret leaves the controller's default certificate", () => {
    const verdict = servedVerdict(entryOf("missing-secret"));

    expect(verdict.tone).toBe("critical");
    expect(verdict.reason).toMatch(/nowhere-tls does not exist.*default certificate/);
  });

  it("names the Certificate that renews a managed one", () => {
    expect(servedVerdict(entryOf("managed"))).toMatchObject({
      tone: "ok",
      reason: "Certificate managed-tls writes Secret managed-tls and renews it.",
    });
  });

  it("names the Certificate still issuing one that is pending", () => {
    const writer = variantOf(certificateNamed("never-issued"), (raw) => {
      raw.spec.secretName = "nowhere-tls";
    });
    const pending = getServedTls(ingresses(), tlsSecrets(), [...certificates(), writer]).find(
      (each) => each.ingress === "missing-secret",
    );

    expect(pending && servedVerdict(pending)).toMatchObject({
      tone: "warning",
      reason: "Certificate never-issued will write Secret nowhere-tls; it is still being issued.",
    });
  });
});

describe("a TLS Secret's drawer", () => {
  it("lists the Ingresses in its namespace that serve it", () => {
    expect(ingressesServing(secretNamed("hand-made-tls"), ingresses())).toEqual(["unmanaged"]);
    expect(ingressesServing(secretNamed("leftover-tls"), ingresses())).toEqual([]);
  });

  it("does not count an Ingress in another namespace serving a Secret of the same name", () => {
    const elsewhere = variantOf(secretNamed("hand-made-tls"), (raw) => {
      raw.metadata.namespace = "kube-system";
    });

    expect(ingressesServing(elsewhere, ingresses())).toEqual([]);
  });

  it("shows cert-manager's annotations only, sorted, the empty ones left out", () => {
    const shown = annotationsOfInterest(secretNamed("managed-tls"));

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(([key, value]) => key.startsWith("cert-manager.io/") && value !== "")).toBe(
      true,
    );
    expect(shown.map(([key]) => key)).toEqual([...shown.map(([key]) => key)].sort());
    expect(annotationsOfInterest(secretNamed("hand-made-tls"))).toEqual([]);
  });

  it("calls a served Secret no Certificate writes critical, naming who serves it", () => {
    const verdict = secretVerdict(secretNamed("hand-made-tls"), certificates(), ingresses());

    expect(verdict).toMatchObject({ tone: "critical", label: "Served, not renewed" });
    expect(verdict.reason).toBe(
      "No Certificate writes it, and no cert-manager annotation names one. Ingress unmanaged serves it, and nothing renews it.",
    );
  });

  it("names every Ingress serving it, in the plural", () => {
    const twice = [
      ...ingresses(),
      variantOf(
        ingresses().find((each) => each.getName() === "unmanaged") as ReturnType<
          typeof ingresses
        >[0],
        (raw) => {
          raw.metadata.name = "unmanaged-too";
        },
      ),
    ];

    expect(secretVerdict(secretNamed("hand-made-tls"), certificates(), twice).reason).toMatch(
      /Ingresses unmanaged, unmanaged-too serve it/,
    );
  });

  it("calls an unserved one informational, since another controller may keep it", () => {
    const verdict = secretVerdict(secretNamed("k3s-serving"), certificates(), ingresses());

    expect(verdict).toMatchObject({ tone: "info", label: "Not served" });
    expect(verdict.reason).toMatch(/another controller/);
  });

  it("names the deleted Certificate a leftover Secret was written for", () => {
    const others = certificates().filter((each) => each.getName() !== "managed-tls");
    const verdict = secretVerdict(secretNamed("managed-tls"), others, ingresses());

    expect(verdict.reason).toMatch(
      /^cert-manager wrote it for Certificate managed-tls, which no longer exists in demo\./,
    );
    expect(verdict.tone).toBe("critical");
  });

  it("says a managed one is renewed by its Certificate", () => {
    expect(secretVerdict(secretNamed("web-tls"), certificates(), ingresses())).toEqual({
      tone: "ok",
      label: "Managed",
      reason: "Certificate web-tls writes it and renews it.",
    });
  });
});
