import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

/**
 * Whether the numbers on the pages are true.
 *
 * Where the truth is something the cluster states outright — how many
 * Certificates exist, which are not Ready, which Ingress entries serve a Secret
 * — it is asked for, through the host's own proxy from inside the frame, so
 * nothing about the development cluster is written down here.
 *
 * Where the truth is a rule of this extension's — which renewals are late,
 * which certificates end within the month — asking would mean re-implementing
 * the rule in the test. There the check is that the page agrees with itself: a
 * card has to count exactly what the list it opens shows. A card and its list
 * disagreeing is the kind of thing nobody notices for months.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

interface CertificateStatus {
  status?: { conditions?: { type: string; status: string }[] };
}

interface IngressTls {
  spec?: { tls?: { secretName?: string }[] };
}

describe("the numbers the cert-manager pages show", () => {
  let session: Session;
  let frame: number;
  let certificates: CertificateStatus[];

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
    certificates = await clusterItems<CertificateStatus>(
      session,
      frame,
      "/apis/cert-manager.io/v1/certificates",
    );
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const openOverview = async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor("the cards", async () => (await countOf(".CertManager-card")) > 0 || undefined);
  };

  /** The number above a card's label. */
  const cardValue = (label: string) =>
    session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('.CertManager-card')]
          .find((each) => each.querySelector('.CertManager-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        return card ? Number.parseInt(card.querySelector('.CertManager-card__value').textContent, 10) : -1;
      })()`,
      frame,
    );

  /** How many rows the picker lists under a chip, reached by pressing the card. */
  const listedBehind = async (label: string) => {
    await openOverview();
    await clickByText(session, frame, "button.CertManager-card", label);
    await waitFor(
      "the picker",
      async () =>
        (await session.evaluate<boolean>("location.pathname.endsWith('/certificates')", frame)) ||
        undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    return countOf(".CertManager-picker__item");
  };

  it("counts the Certificates the cluster has", async () => {
    await openOverview();

    expect(await cardValue("Certificates")).toBe(certificates.length);
  }, 90_000);

  it("counts as not ready exactly the ones whose Ready condition is not true", async () => {
    const notReady = certificates.filter(
      (each) =>
        each.status?.conditions?.find((condition) => condition.type === "Ready")?.status !== "True",
    ).length;

    await openOverview();

    expect(await cardValue("Not ready")).toBe(notReady);
    expect(await listedBehind("Not ready")).toBe(notReady);
  }, 120_000);

  it.each(["Renewal failing", "Ending within 30 days", "Certificates"])(
    "lists behind %s exactly the number on the card",
    async (label) => {
      await openOverview();
      const counted = await cardValue(label);

      expect(counted, `no card labelled ${label}`).toBeGreaterThanOrEqual(0);
      expect(await listedBehind(label)).toBe(counted);
    },
    120_000,
  );

  it("says in its headline how many need attention, out of every certificate", async () => {
    await openOverview();

    const headline = await textOf(session, frame, ".CertManager-page__headline");
    const rows = await countOf(".CertManager-list .CertManager-row");
    const match = /(\d+) of (\d+) certificates?/.exec(headline);

    expect(match, `the headline does not count: ${headline}`).not.toBeNull();
    expect(Number(match?.[1]), "the headline's count is not what the list shows").toBe(rows);
    expect(Number(match?.[2]), "the headline's total is not the cluster's").toBe(
      certificates.length,
    );
  }, 90_000);

  it("puts what is broken now above what will break later", async () => {
    await openOverview();

    const severities = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.CertManager-list .CertManager-row')]
         .map((row) => row.className.match(/CertManager-row--(critical|warning)/)?.[1] ?? "none")`,
      frame,
    );

    expect(severities.length, "one row cannot demonstrate an order").toBeGreaterThan(1);

    const rank = { critical: 0, warning: 1, none: 2 } as Record<string, number>;

    for (let at = 1; at < severities.length; at++) {
      expect(rank[severities[at - 1] ?? "none"]).toBeLessThanOrEqual(
        rank[severities[at] ?? "none"] ?? 2,
      );
    }
  }, 90_000);

  it("counts on the issuers card what the issuers page lists as broken or missing", async () => {
    await openOverview();
    const counted = await cardValue("Issuers not ready or missing");

    await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
    await waitFor("the issuers", async () => (await countOf(".CertManager-box")) > 0 || undefined);

    const listed =
      (await countOf('.CertManager-box[data-state="failed"]')) +
      (await countOf('.CertManager-box[data-state="missing"]'));

    expect(listed).toBe(counted);
  }, 120_000);

  it("lists every TLS entry the cluster's Ingresses serve from a Secret", async () => {
    const ingresses = await clusterItems<IngressTls>(
      session,
      frame,
      "/apis/networking.k8s.io/v1/ingresses",
    );
    const entries = ingresses
      .flatMap((each) => each.spec?.tls ?? [])
      .filter((each) => each.secretName);

    await clickSidebar(session, frame, "cert-manager-unmanaged", "cert-manager");

    const served = await waitFor("the served list", async () => {
      const rows = await countOf(".CertManager-box");

      return rows > 0 ? rows : undefined;
    });

    expect(served).toBe(entries.length);

    await openOverview();
    const gaps = await cardValue("Served TLS with no Certificate");

    await clickSidebar(session, frame, "cert-manager-unmanaged", "cert-manager");
    await waitFor(
      "the served list",
      async () => (await countOf(".CertManager-box")) > 0 || undefined,
    );

    const listedGaps =
      (await countOf('.CertManager-box[data-state="unmanaged"]')) +
      (await countOf('.CertManager-box[data-state="missing"]'));

    expect(listedGaps).toBe(gaps);
  }, 150_000);
});
