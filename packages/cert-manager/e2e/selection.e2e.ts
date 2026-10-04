import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: each bulk renewal is cancelled, or confirmed with the wrong word.

const LIST = '[data-section="cert-manager-certificates"]';

interface CertificateConditions {
  metadata: { namespace: string; name: string };
  status?: { conditions?: { type: string; status: string; lastTransitionTime?: string }[] };
}

describe("ticking certificates", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const open = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor("the certificates", async () =>
      (await countOf(`${LIST} tbody tr`)) > 1 ? true : undefined,
    );
  };

  /** Ticks the first `count` rows by their own checkbox, as a person would. */
  const tick = (count: number) =>
    session.evaluate(
      `[...document.querySelectorAll('${LIST} tbody .CertManager-table__check input')].slice(0, ${count}).forEach((box) => box.click())`,
      frame,
    );

  const tickAll = () =>
    session.evaluate(
      `document.querySelector('${LIST} thead .CertManager-table__check input').click()`,
      frame,
    );

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

  // A renewal sets Issuing; nothing else in the cluster moves it while the suite runs.
  const issuing = async () =>
    (
      await clusterItems<CertificateConditions>(
        session,
        frame,
        "/apis/cert-manager.io/v1/certificates",
      )
    )
      .map((each) => {
        const condition = each.status?.conditions?.find((one) => one.type === "Issuing");

        return `${each.metadata.namespace}/${each.metadata.name} ${condition?.status ?? "-"} ${condition?.lastTransitionTime ?? "-"}`;
      })
      .sort();

  it("shows the selection bar with Renew once rows are ticked, and hides it when none are", async () => {
    await open();

    expect(await countOf('[data-section="selection"]')).toBe(0);

    await tick(2);

    const bar = await waitFor("the selection bar", async () => {
      const text = await session.evaluate<string>(
        `document.querySelector('[data-section="selection"]')?.textContent ?? ""`,
        frame,
      );

      return text || undefined;
    });

    expect(bar).toMatch(/2 selected/);
    expect(
      await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="selection"] button')].map((each) => each.textContent.trim())`,
        frame,
      ),
    ).toEqual(["Renew"]);
    expect(await countOf(`${LIST} tbody .CertManager-table__row--selected`)).toBe(2);
    expect(await designViolations(session, frame, "CertManager")).toEqual([]);

    await tick(2);
    await waitFor("the bar to go once nothing is ticked", async () =>
      (await countOf('[data-section="selection"]')) === 0 ? true : undefined,
    );
  }, 60_000);

  it("ticks a certificate without opening its drawer", async () => {
    await open();
    await tick(1);
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(
      await countOf('.CertManagerObjectDrawer [data-section="cert-manager-certificate"]'),
    ).toBe(0);

    await tick(1);
  }, 60_000);

  it("asks for confirm before renewing every certificate, naming those it skips and why", async () => {
    await open();
    await tickAll();
    await clickByText(session, frame, '[data-section="selection"] button', "Renew");

    const dialog = await dialogText();

    expect(dialog).toMatch(/Renew \d+ certificates?\?/);
    expect(dialog).toMatch(/Skipped: .*already issuing/);
    expect(dialog).toMatch(/Type confirm to confirm/);
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);

    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
    await tickAll();
  }, 60_000);

  it("renews nothing when the wrong word is typed", async () => {
    const before = await issuing();

    await open();
    await tickAll();
    await clickByText(session, frame, '[data-section="selection"] button', "Renew");
    await dialogText();

    const label = await session.evaluate<string>(
      `[...document.querySelectorAll('.ConfirmDialog button')].map((each) => each.textContent.trim()).find((each) => /^Renew \\d+$/.test(each)) ?? ""`,
      frame,
    );

    expect(label).not.toBe("");

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", label);

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await issuing()).toEqual(before);

    await tickAll();
  }, 60_000);
});
