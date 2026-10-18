import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  clusterItems,
  countOf,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { closeDrawer as closeDrawerOf, openRow as openRowOf } from "../support/cert-manager";
import {
  type Conditioned,
  clickDrawerIcon,
  conditionOf,
  DRAWER,
  issuingSnapshot,
} from "../support/lists";

// Read-only: the renewal is opened and cancelled at its confirmation.

interface CertificateObject extends Conditioned {
  spec: { issuerRef: { kind?: string; name: string } };
}

describe("opening a row of each cert-manager list", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const title = () => drawerTitle(session, frame, DRAWER);

  const issuing = () => issuingSnapshot(session, frame);

  const clickRenew = () => clickDrawerIcon(session, frame, "autorenew");

  const confirmation = (name: string) =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text.includes(name) ? text : undefined;
    });

  const cancel = async () => {
    await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the confirmation to close", async () =>
      (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  const openRow = (page: string, list: string, section: string, predicate?: string) =>
    openRowOf(session, frame, page, list, section, predicate);

  const closeDrawer = (section: string) => closeDrawerOf(session, frame, section);

  it("asks before renewing from the title bar, and writes nothing when cancelled", async () => {
    // A healthy row nothing is issuing, so the renewal is offered.
    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      "each.querySelector('.CertManager-status--ok') && each.textContent.includes(' left')",
    );

    const name = (await title()).replace(/^Certificate: /, "");
    const before = await issuing();

    await clickRenew();

    const question = await confirmation(name);

    expect(question).toMatch(/stays in use/);
    expect(
      await session.evaluate<number>(
        "document.querySelectorAll('.ConfirmDialog input').length",
        frame,
      ),
    ).toBe(0);
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);
    expect(
      await countOf(session, frame, `${DRAWER} [data-section="cert-manager-certificate"]`),
      "the menu item's click closed the drawer",
    ).toBe(1);

    await cancel();
    expect(await issuing(), "cancelling still renewed").toEqual(before);
    await closeDrawer("cert-manager-certificate");
  }, 90_000);

  it("warns, in the theme's warning colour, of a renewal its broken issuer will fail", async () => {
    const [certificates, issuers, clusterIssuers] = await Promise.all([
      clusterItems<CertificateObject>(session, frame, "/apis/cert-manager.io/v1/certificates"),
      clusterItems<Conditioned>(session, frame, "/apis/cert-manager.io/v1/issuers"),
      clusterItems<Conditioned>(session, frame, "/apis/cert-manager.io/v1/clusterissuers"),
    ]);
    const issuerOf = ({ metadata, spec }: CertificateObject) =>
      spec.issuerRef.kind === "ClusterIssuer"
        ? clusterIssuers.find((each) => each.metadata.name === spec.issuerRef.name)
        : issuers.find(
            (each) =>
              each.metadata.namespace === metadata.namespace &&
              each.metadata.name === spec.issuerRef.name,
          );
    // Ready and not issuing, so Renew is offered, on an issuer that exists and is not ready.
    const target = certificates.find((each) => {
      const issuer = issuerOf(each);

      return (
        conditionOf(each, "Ready")?.status === "True" &&
        conditionOf(each, "Issuing")?.status !== "True" &&
        issuer !== undefined &&
        conditionOf(issuer, "Ready")?.status !== "True"
      );
    });

    expect(
      target,
      "the seed has no Ready certificate, not issuing, on a broken issuer (issuer-broken on flaky-ca)",
    ).toBeDefined();

    const { namespace = "", name } = target?.metadata ?? { name: "" };

    await openRow(
      "cert-manager-certificates",
      "cert-manager-certificates",
      "cert-manager-certificate",
      `each.querySelector('td:nth-child(2)')?.textContent.trim() === ${JSON.stringify(name)} && each.querySelector('td:nth-child(3)')?.textContent.trim() === ${JSON.stringify(namespace)}`,
    );

    const before = await issuing();

    await clickRenew();
    await confirmation(name);

    const warning = await session.evaluate<{
      text: string;
      colour: string;
      tone: string;
      body: string;
    }>(
      `(() => {
        const root = document.querySelector('.ConfirmDialog .CertManager-dialog');
        const warning = root?.querySelector('.CertManager-text--warning');
        const probe = document.createElement("span");
        probe.style.color = "var(--cert-manager-tone-warning)";
        root?.append(probe);
        const tone = getComputedStyle(probe).color;
        probe.remove();
        return {
          text: warning?.textContent ?? "",
          colour: warning ? getComputedStyle(warning).color : "",
          tone,
          body: root ? getComputedStyle(root).color : "",
        };
      })()`,
      frame,
    );

    expect(warning.text).toMatch(
      /^Its issuer is not usable \((Cluster)?Issuer [\w.-]+\), so the renewal will fail/,
    );
    expect(warning.colour).toBe(warning.tone);
    expect(warning.colour, "the warning reads as plain text").not.toBe(warning.body);
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);

    await cancel();
    expect(await issuing(), "cancelling still renewed").toEqual(before);
    await closeDrawer("cert-manager-certificate");
  }, 120_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
