import { describe, expect, it, vi } from "vitest";

import {
  annotationsOfInterest,
  describeServedHeadline,
  getServedTls,
  getUnmanagedSecrets,
  hostsOf,
  ingressesKnown,
  ingressesServing,
  isGap,
  isServedFilter,
  managingCertificateOf,
  matchesServedFilter,
  SERVED_FILTER_LABELS,
  SERVED_STATES,
  secretSearchTexts,
  secretVerdict,
  servedEmptyText,
  servedSearchTexts,
  servedVerdict,
  unmanagedSecretsEmptyText,
} from "../../src/renderer/api/unmanaged/unmanaged";
import {
  certificateNamed,
  certificates,
  ingresses,
  tlsSecrets,
  variantOf,
} from "../support/fixtures";

// Besides this seed: the HTTP-01 solver Ingress (no TLS), and the TLS Secrets of k3s and the other seeds.

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
      "acme-web",
      "managed",
      "missing-secret",
      "unmanaged",
    ]);
  });

  it("says which are managed, which nothing renews, and which are not there", () => {
    const state = Object.fromEntries(served.map((each) => [each.ingress, each.state]));

    expect(state).toEqual({
      "acme-web": "pending",
      managed: "managed",
      unmanaged: "unmanaged",
      "missing-secret": "missing",
    });
  });

  it("puts the gaps first", () => {
    expect(served.map((each) => each.state)).toEqual([
      "unmanaged",
      "missing",
      "pending",
      "managed",
    ]);
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

  it("shows Any in the Hosts cell for an entry without hosts, not a blank", () => {
    const hostless = ingresses().map((ingress) =>
      ingress.getName() === "unmanaged"
        ? variantOf(ingress, (raw) => {
            delete raw.spec.tls[0].hosts;
          })
        : ingress,
    );
    const cells = Object.fromEntries(
      getServedTls(hostless, tlsSecrets(), certificates()).map((each) => [
        each.ingress,
        hostsOf(each),
      ]),
    );

    expect(cells.unmanaged).toBe("Any");
    expect(cells.managed).toBe("managed.demo.test");
  });
});

describe("TLS Secrets no Certificate writes", () => {
  it("lists them all, served or not, the other controllers' included", () => {
    const unmanaged = getUnmanagedSecrets(tlsSecrets(), certificates()).map(
      (each) => `${each.getNs()}/${each.getName()}`,
    );

    expect(unmanaged).toEqual([
      "cnpg-system/cnpg-webhook-cert",
      "databases/analytics-db-replication",
      "databases/analytics-db-server",
      "databases/audit-db-replication",
      "databases/audit-db-server",
      "databases/billing-db-replication",
      "databases/billing-db-server",
      "databases/inventory-db-replication",
      "databases/orders-db-pooler",
      "databases/orders-db-replication",
      "databases/orders-db-server",
      "databases/reports-db-pooler",
      "databases/reports-db-replication",
      "databases/reports-db-server",
      "demo/hand-made-tls",
      "demo/leftover-tls",
      "demo/retired-tls",
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

  it("names the Certificate still issuing acme-web's Secret", () => {
    expect(servedVerdict(entryOf("acme-web"))).toEqual({
      tone: "warning",
      label: "Being issued",
      reason: "Certificate acme-web will write Secret acme-web; it is still being issued.",
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

  it("names the Certificate retired-tls was written for, which was deleted", () => {
    expect(secretVerdict(secretNamed("retired-tls"), certificates(), ingresses())).toEqual({
      tone: "info",
      label: "Not served",
      reason:
        "cert-manager wrote it for Certificate retired-tls, which no longer exists in demo. No Ingress here serves it; another controller, such as the API server or a webhook, may keep it.",
    });
  });

  it("says a managed one is renewed by its Certificate", () => {
    expect(secretVerdict(secretNamed("web-tls"), certificates(), ingresses())).toEqual({
      tone: "ok",
      label: "Managed",
      reason: "Certificate web-tls writes it and renews it.",
    });
  });
});

describe("served TLS before the Secrets have been listed", () => {
  const unlisted = getServedTls(ingresses(), [], certificates(), () => false);
  const stateOf = (ingress: string) => unlisted.find((each) => each.ingress === ingress)?.state;

  it("does not call a Secret missing that may exist", () => {
    expect(unlisted.some((each) => each.state === "missing")).toBe(false);
    expect(stateOf("missing-secret")).toBe("unchecked");
    expect(stateOf("unmanaged")).toBe("unchecked");
  });

  it("counts the same gaps as once they are listed", () => {
    const listed = getServedTls(ingresses(), tlsSecrets(), certificates());

    expect(unlisted.filter(isGap)).toHaveLength(listed.filter(isGap).length);
  });

  it("calls a Secret managed once its Certificate has issued, and pending before", () => {
    expect(stateOf("managed")).toBe("managed");
    expect(stateOf("acme-web")).toBe("pending");
  });

  it("says nothing renews it, and that whether it exists is not known", () => {
    const entry = unlisted.find((each) => each.ingress === "unmanaged");

    if (!entry) throw new Error("no unmanaged Ingress in the fixtures");

    expect(servedVerdict(entry)).toMatchObject({ tone: "critical", label: "No Certificate" });
    expect(servedVerdict(entry).reason).toMatch(/not known: TLS Secrets have not been listed/);
  });
});

describe("the cost of matching Secrets to Certificates", () => {
  it("reads each Certificate a fixed number of times, however many Secrets there are", () => {
    const owned = certificates();
    const spies = owned.map((certificate) => vi.spyOn(certificate, "getNs"));
    const secrets = tlsSecrets();

    getUnmanagedSecrets(secrets, owned);
    getServedTls(ingresses(), secrets, owned);

    for (const spy of spies) expect(spy.mock.calls.length).toBeLessThan(5);
    expect(secrets.length).toBeGreaterThan(10);
  });
});

describe("the served filter the overview's card opens", () => {
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());

  it("lists under No Certificate exactly what the card counts", () => {
    const counted = served.filter(isGap).length;
    const listed = served.filter((each) => matchesServedFilter(each, "gaps"));

    expect(counted).toBeGreaterThan(0);
    expect(listed).toHaveLength(counted);
    expect(listed.map((each) => each.ingress).sort()).toEqual(["missing-secret", "unmanaged"]);
  });

  it("lists every entry under All, and takes only its own names from a route", () => {
    expect(served.filter((each) => matchesServedFilter(each, "all"))).toHaveLength(served.length);
    expect(Object.keys(SERVED_FILTER_LABELS).every(isServedFilter)).toBe(true);
    expect(isServedFilter("constructor")).toBe(false);
  });
});

describe("what the unmanaged page says about the Ingresses", () => {
  const listed = { state: "ready" as const, refused: false };
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());

  it("judges nothing until the Ingresses are listed for this scope", () => {
    expect(describeServedHeadline("ready", { state: "connecting", refused: false }, [], true)).toBe(
      "Unmanaged TLS",
    );
    expect(servedEmptyText("ready", { state: "connecting", refused: false }, true)).toBe(
      "Listing the Ingresses…",
    );
  });

  it("never says no Ingress serves TLS when the Ingresses were refused", () => {
    const refused = { state: "ready" as const, refused: true };

    expect(ingressesKnown(refused)).toBe(false);
    expect(describeServedHeadline("ready", refused, [], true)).toBe("Unmanaged TLS");
    expect(servedEmptyText("ready", refused, true)).toBe(
      "Not known: the Ingresses could not be listed.",
    );
    expect(servedEmptyText("ready", { state: "unreachable", refused: false }, true)).toBe(
      "Not known: the Ingresses could not be listed.",
    );
  });

  it("puts cert-manager's own load state first", () => {
    expect(describeServedHeadline("connecting", listed, served, true)).toBe("Unmanaged TLS");
    expect(servedEmptyText("connecting", listed, true)).toBe("Connecting to the cluster…");
  });

  it("counts the gaps once both are listed", () => {
    expect(describeServedHeadline("ready", listed, served, true)).toBe(
      `2 of ${served.length} served TLS Secrets have no Certificate`,
    );
    expect(
      describeServedHeadline(
        "ready",
        listed,
        served.filter((each) => !isGap(each)),
        true,
      ),
    ).toMatch(/^All \d+ TLS Secrets served by an Ingress have a Certificate$/);
    expect(
      describeServedHeadline(
        "ready",
        listed,
        served.filter((each) => each.ingress === "unmanaged"),
        true,
      ),
    ).toBe("1 of 1 served TLS Secret has no Certificate");
    expect(
      describeServedHeadline(
        "ready",
        listed,
        served.filter((each) => each.ingress === "managed"),
        true,
      ),
    ).toBe("The TLS Secret served by an Ingress has a Certificate");
    expect(describeServedHeadline("ready", listed, [], true)).toBe(
      "No Ingress serves TLS from a Secret",
    );
    expect(servedEmptyText("ready", listed, true)).toBe(
      "No Ingress in the chosen namespaces serves TLS from a Secret.",
    );
  });
});

describe("what the unmanaged page says without the Certificates", () => {
  const listed = { state: "ready" as const, refused: false };
  const served = getServedTls(ingresses(), tlsSecrets(), certificates());

  it("judges no served Secret when the Certificate list was refused", () => {
    expect(describeServedHeadline("ready", listed, served, false)).toBe("Unmanaged TLS");
    expect(servedEmptyText("ready", listed, false)).toBe(
      "Not known: the Certificates could not be listed.",
    );
  });

  it("never says every TLS Secret has a Certificate when it was refused", () => {
    expect(unmanagedSecretsEmptyText("ready", false, undefined)).toBe(
      "Not known: the Certificates could not be listed.",
    );
  });
});

describe("what the unmanaged page says when TLS Secrets were refused", () => {
  it("knows nothing when every namespace refused", () => {
    expect(
      unmanagedSecretsEmptyText("ready", true, { namespaces: ["demo"], everywhere: true }),
    ).toBe("Not known: TLS Secrets could not be listed.");
  });

  it("names the namespaces it could not list", () => {
    expect(
      unmanagedSecretsEmptyText("ready", true, {
        namespaces: ["kube-system", "redis"],
        everywhere: false,
      }),
    ).toBe(
      "Every TLS Secret listed is written by a Certificate; those in kube-system, redis could not be listed.",
    );
  });

  it("says every TLS Secret is written only once all were listed", () => {
    expect(unmanagedSecretsEmptyText("ready", true, undefined)).toBe(
      "Every TLS Secret in the chosen namespaces is written by a Certificate.",
    );
    expect(unmanagedSecretsEmptyText("connecting", true, undefined)).toBe(
      "Connecting to the cluster…",
    );
  });
});
