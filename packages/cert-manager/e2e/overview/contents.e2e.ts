import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  clusterItems,
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { CERTIFICATE_ROWS, ISSUER_ROWS, SERVED_ROWS } from "../support/lists";

interface CertificateStatus {
  status?: { conditions?: { type: string; status: string }[]; notAfter?: string };
}

const DAY = 24 * 60 * 60 * 1000;

interface IngressTls {
  spec?: { tls?: { secretName?: string }[] };
}

describe("the numbers the cert-manager pages show", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let certificates: CertificateStatus[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    certificates = await clusterItems<CertificateStatus>(
      session,
      frame,
      "/apis/cert-manager.io/v1/certificates",
    );
  }, 180_000);

  afterAll(() => session?.close());

  const openOverview = async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await waitFor(
      "the cards",
      async () => (await countOf(session, frame, ".CertManager-card")) > 0 || undefined,
    );
  };

  const cardValue = (label: string) =>
    session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('.CertManager-card')]
          .find((each) => each.querySelector('.CertManager-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        return card ? Number.parseInt(card.querySelector('.CertManager-card__value').textContent, 10) : -1;
      })()`,
      frame,
    );

  /** The rows a card opens, once its chip is pressed and the page has listed. */
  const listedBehind = async (
    label: string,
    page = "/certificates",
    rows = CERTIFICATE_ROWS,
    chip = label === "Certificates" ? "All" : label,
  ) => {
    await openOverview();
    await clickWhenShown(session, frame, "button.CertManager-card", label);
    await waitFor(
      `the list behind ${label}`,
      async () =>
        (await session.evaluate<boolean>(
          `location.pathname.endsWith(${JSON.stringify(page)})
            && [...document.querySelectorAll('.CertManager-filter[aria-pressed="true"]')].some((each) => each.textContent.trim() === ${JSON.stringify(chip)})
            && !document.body.textContent.includes("Connecting to the cluster")
            && !document.body.textContent.includes("Listing the Ingresses")`,
          frame,
        )) || undefined,
    );

    return countOf(session, frame, rows);
  };

  it("counts the Certificates the cluster has", async () => {
    await openOverview();

    expect(await cardValue("Certificates")).toBe(certificates.length);
  }, 90_000);

  const ready = (each: CertificateStatus) =>
    each.status?.conditions?.find((condition) => condition.type === "Ready")?.status === "True";
  const left = (each: CertificateStatus) =>
    each.status?.notAfter ? Date.parse(each.status.notAfter) - Date.now() : undefined;
  const endsWithin = (days: number) =>
    certificates.filter((each) => {
      const remaining = left(each);

      return remaining !== undefined && remaining > 0 && remaining <= days * DAY;
    }).length;

  it("counts as not ready the ones not Ready with no valid previous certificate to serve", async () => {
    const notReady = certificates.filter((each) => !ready(each) && !((left(each) ?? 0) > 0)).length;

    await openOverview();

    expect(await cardValue("Not ready")).toBe(notReady);
    expect(await listedBehind("Not ready")).toBe(notReady);
  }, 120_000);

  it("counts as out of date the ones not Ready that still serve a valid certificate", async () => {
    const outOfDate = certificates.filter((each) => !ready(each) && (left(each) ?? 0) > 0).length;

    await openOverview();

    expect(await cardValue("Out of date")).toBe(outOfDate);
    expect(await listedBehind("Out of date")).toBe(outOfDate);
  }, 120_000);

  it("counts what ends within 7 and 30 days, and only the month's card opens a list", async () => {
    await openOverview();

    expect(await cardValue("Ends within 7 days")).toBe(endsWithin(7));
    expect(await cardValue("Ends within 30 days")).toBe(endsWithin(30));
    expect(endsWithin(7), "the seed's ends-this-week ends within 7 days").toBeGreaterThan(0);
    expect(
      await session.evaluate<string[]>(
        `[...document.querySelectorAll('.CertManager-card')]
           .filter((each) => each.querySelector('.CertManager-card__label')?.textContent.trim().startsWith("Ends within"))
           .map((each) => each.tagName + " " + each.querySelector('.CertManager-card__label').textContent.trim())`,
        frame,
      ),
    ).toEqual(["DIV Ends within 7 days", "BUTTON Ends within 30 days"]);
  }, 90_000);

  it.each(["Renewal failing", "Ends within 30 days", "Certificates"])(
    "lists behind %s exactly the number on the card",
    async (label) => {
      await openOverview();
      const counted = await cardValue(label);

      expect(counted, `no card labelled ${label}`).toBeGreaterThanOrEqual(0);
      expect(await listedBehind(label)).toBe(counted);
    },
    120_000,
  );

  it("marks the Renewal due of a certificate whose renewal is failing as late, and of no Ready one", async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the certificates",
      async () => (await countOf(session, frame, CERTIFICATE_ROWS)) > 0 || undefined,
    );

    const marked = await session.evaluate<{ state: string; late: boolean }[]>(
      `[...document.querySelectorAll(${JSON.stringify(CERTIFICATE_ROWS)})].map((row) => ({
        state: row.querySelector('.CertManager-status')?.textContent.trim() ?? "",
        late: Boolean(row.querySelector('td:nth-child(7) .CertManager-text--warning')),
      }))`,
      frame,
    );
    const failing = marked.filter((each) => each.state === "Renewal failing");

    expect(failing.length, "the seed's renewal-stalls fails to renew").toBeGreaterThan(0);
    expect(failing.every((each) => each.late)).toBe(true);
    expect(marked.filter((each) => each.state === "Ready" && each.late)).toEqual([]);
  }, 90_000);

  it("says in its headline how many need attention, out of every certificate", async () => {
    await openOverview();

    const headline = await textOf(session, frame, ".CertManager-page__headline");
    const rows = await countOf(session, frame, ".CertManager-list .CertManager-row");
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

  it("lists behind the issuers card exactly the broken or missing issuers it counts", async () => {
    await openOverview();
    const counted = await cardValue("Issuers not ready or missing");

    expect(counted, "the seed breaks broken-ca and flaky-ca").toBeGreaterThan(0);
    expect(
      await listedBehind(
        "Issuers not ready or missing",
        "/issuers",
        ISSUER_ROWS,
        "Not ready or missing",
      ),
    ).toBe(counted);
    expect(
      (await countOf(session, frame, `${ISSUER_ROWS}[data-state="failed"]`)) +
        (await countOf(session, frame, `${ISSUER_ROWS}[data-state="missing"]`)),
    ).toBe(counted);
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
      const rows = await countOf(session, frame, SERVED_ROWS);

      return rows > 0 ? rows : undefined;
    });

    expect(served).toBe(entries.length);

    await openOverview();
    const gaps = await cardValue("Served TLS with no Certificate");

    expect(
      await listedBehind(
        "Served TLS with no Certificate",
        "/unmanaged",
        SERVED_ROWS,
        "No Certificate",
      ),
    ).toBe(gaps);
    expect(
      (await countOf(session, frame, `${SERVED_ROWS}[data-state="unmanaged"]`)) +
        (await countOf(session, frame, `${SERVED_ROWS}[data-state="missing"]`)),
    ).toBe(gaps);
  }, 150_000);

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
