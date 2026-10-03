import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterFrame,
  connect,
  openCluster,
  selectAllNamespaces,
  selectNamespace,
  textOf,
  waitFor,
} from "../../../build/e2e/freelens";

// Not `openWorkbench`: widening the scope before our pages mount hides the defect.

const EMPTY_NAMESPACE = "default";

describe("changing the namespace scope under the cert-manager pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);

    // The namespace control is on the host's list pages.
    await clickSidebar(session, frame, "pods", "workloads");
  }, 180_000);

  afterAll(() => session?.close());

  const headline = () =>
    waitFor("the cert-manager headline", async () => {
      const text = await textOf(session, frame, ".CertManager-page__headline");

      return text.length > 0 ? text : undefined;
    });

  it("reports nothing while scoped to a namespace that has no certificates", async () => {
    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");

    expect(await headline()).toBe("No certificates");
  }, 120_000);

  it("catches up once the scope widens", async () => {
    // The stores are already loaded here, which is the trap.
    await clickSidebar(session, frame, "pods", "workloads");
    await selectAllNamespaces(session, frame);
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");

    const widened = await waitFor("the headline to count something", async () => {
      const text = await textOf(session, frame, ".CertManager-page__headline");

      return text === "No certificates" || text.length === 0 ? undefined : text;
    });

    expect(widened).toMatch(/of [1-9]\d* certificates|All [1-9]\d* certificates/);
  }, 120_000);
});

// Not Requests: it is the host's list, with the host's selector.
const OWN_PAGES = [
  "cert-manager-overview",
  "cert-manager-certificates",
  "cert-manager-issuers",
  "cert-manager-unmanaged",
];

describe("the namespace selector on the cert-manager pages", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    session = await connect();
    await openCluster(session);
    frame = await clusterFrame(session);
  }, 180_000);

  afterAll(() => session?.close());

  const textMatching = (selector: string, matching: RegExp) =>
    waitFor(`${selector} matching ${matching}`, async () => {
      const text = await textOf(session, frame, selector);

      return matching.test(text) ? text : undefined;
    });

  const COUNTED = /of [1-9]\d* certificates|All [1-9]\d* certificates/;

  it.each(OWN_PAGES)(
    "offers it on %s",
    async (id) => {
      await clickSidebar(session, frame, id, "cert-manager");

      const selectors = await waitFor(`${id}'s namespace selector`, async () => {
        const count = await session.evaluate<number>(
          `document.querySelectorAll('.CertManager-namespaces [class*="Select__control"]').length`,
          frame,
        );

        return count > 0 ? count : undefined;
      });

      expect(selectors).toBe(1);
    },
    60_000,
  );

  it("empties the overview from its own selector, with the page open, and fills it again", async () => {
    await clickSidebar(session, frame, "cert-manager-overview", "cert-manager");
    await selectAllNamespaces(session, frame);
    await textMatching(".CertManager-page__headline", COUNTED);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(await textMatching(".CertManager-page__headline", /^No certificates$/)).toBe(
      "No certificates",
    );
    expect(await textOf(session, frame, ".CertManager-page__subline")).toMatch(/namespaces chosen/);

    await selectAllNamespaces(session, frame);
    expect(await textMatching(".CertManager-page__headline", COUNTED)).toMatch(COUNTED);
  }, 120_000);

  it("empties the certificate picker the same way, and fills it again", async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor(
      "the picker",
      async () =>
        (await session.evaluate<number>(
          "document.querySelectorAll('.CertManager-picker__item').length",
          frame,
        )) || undefined,
    );

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(
      await textMatching(".CertManager-picker__empty", /no Certificate in the namespaces/),
    ).toBeTruthy();

    await selectAllNamespaces(session, frame);
    expect(
      await waitFor(
        "the picker to fill again",
        async () =>
          (await session.evaluate<number>(
            "document.querySelectorAll('.CertManager-picker__item').length",
            frame,
          )) || undefined,
      ),
    ).toBeGreaterThan(0);
  }, 120_000);

  it("keeps ClusterIssuers on the issuers page while narrowed, without their certificates", async () => {
    await clickSidebar(session, frame, "cert-manager-issuers", "cert-manager");
    await textMatching(".CertManager-page__headline", /issuers? (is|are)/);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);

    const narrowed = await waitFor("the issuers page to narrow", async () => {
      const state = await session.evaluate<{ boxes: number; chips: number; namespaced: number }>(
        `({
          boxes: document.querySelectorAll('.CertManager-box').length,
          chips: document.querySelectorAll('.CertManager-box .CertManager-chip').length,
          namespaced: [...document.querySelectorAll('.CertManager-box__meta')]
            .filter((each) => each.textContent.startsWith("Issuer in")).length,
        })`,
        frame,
      );

      return state.chips === 0 && state.namespaced === 0 ? state : undefined;
    });

    expect(narrowed.boxes, "the ClusterIssuers went with the scope").toBeGreaterThan(0);

    await selectAllNamespaces(session, frame);
    expect(
      await waitFor(
        "the dependents back",
        async () =>
          (await session.evaluate<number>(
            "document.querySelectorAll('.CertManager-box .CertManager-chip').length",
            frame,
          )) || undefined,
      ),
    ).toBeGreaterThan(0);
  }, 120_000);

  it("empties the unmanaged TLS tables the same way, and fills them again", async () => {
    const rows = () =>
      session.evaluate<number>(
        `document.querySelectorAll('[data-section="served"] tbody tr').length`,
        frame,
      );

    await clickSidebar(session, frame, "cert-manager-unmanaged", "cert-manager");
    await waitFor("the served table", async () => (await rows()) || undefined);

    await selectNamespace(session, frame, EMPTY_NAMESPACE);
    expect(
      await textMatching(".CertManager-page__headline", /^No Ingress serves TLS from a Secret$/),
    ).toBeTruthy();
    expect(await rows()).toBe(0);

    await selectAllNamespaces(session, frame);
    expect(
      await waitFor("the served table back", async () => (await rows()) || undefined),
    ).toBeGreaterThan(0);
  }, 120_000);
});
