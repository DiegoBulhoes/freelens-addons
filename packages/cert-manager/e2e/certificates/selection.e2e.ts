import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  dialogText,
  type ErrorLog,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, issuingSnapshot, LIST } from "../support/lists";

// Read-only: each bulk renewal is cancelled, or confirmed with the wrong word.

describe("ticking certificates", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const open = async () => {
    await clickSidebar(session, frame, "cert-manager-certificates", "cert-manager");
    await waitFor("the certificates", async () =>
      (await countOf(session, frame, `${LIST} tbody tr`)) > 1 ? true : undefined,
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

  const issuing = () => issuingSnapshot(session, frame);

  it("shows the selection bar with Renew once rows are ticked, and hides it when none are", async () => {
    await open();

    expect(await countOf(session, frame, '[data-section="selection"]')).toBe(0);

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
    expect(await countOf(session, frame, `${LIST} tbody .CertManager-table__row--selected`)).toBe(
      2,
    );
    expect(await designViolations(session, frame, "CertManager")).toEqual([]);

    await tick(2);
    await waitFor("the bar to go once nothing is ticked", async () =>
      (await countOf(session, frame, '[data-section="selection"]')) === 0 ? true : undefined,
    );
  }, 60_000);

  it("ticks a certificate without opening its drawer", async () => {
    await open();
    await tick(1);
    await waitFor("the row ticked", async () =>
      (await countOf(session, frame, `${LIST} tbody .CertManager-table__row--selected`)) === 1
        ? true
        : undefined,
    );

    expect(
      await countOf(session, frame, `${DRAWER} [data-section="cert-manager-certificate"]`),
    ).toBe(0);

    await tick(1);
    await waitFor("the bar to go", async () =>
      (await countOf(session, frame, '[data-section="selection"]')) === 0 ? true : undefined,
    );
  }, 60_000);

  it("asks for confirm before renewing every certificate, naming those it skips and why", async () => {
    const before = await issuing();

    await open();
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Renew");

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Renew \d+ certificates?\?/);
    expect(dialog).toMatch(/Skipped: .*already issuing/);
    expect(
      dialog,
      "no ticked certificate on a broken issuer is warned of (seed issuer-broken)",
    ).toMatch(/[\w-]+\/[\w.-]+: Its issuer is not usable/);
    expect(dialog).toMatch(/Type confirm to confirm/);
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);

    await clickWhenShown(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(session, frame, ".ConfirmDialog")) === 0 ? true : undefined,
    );
    expect(await issuing(), "cancelling still renewed").toEqual(before);
    await tickAll();
  }, 60_000);

  it("renews nothing when the wrong word is typed", async () => {
    const before = await issuing();

    await open();
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Renew");
    await dialogText(session, frame);

    const label = await session.evaluate<string>(
      `[...document.querySelectorAll('.ConfirmDialog button')].map((each) => each.textContent.trim()).find((each) => /^Renew \\d+$/.test(each)) ?? ""`,
      frame,
    );

    expect(label).not.toBe("");

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    expect(await dialogColourViolations(session, frame, "CertManager")).toEqual([]);
    await clickWhenShown(session, frame, ".ConfirmDialog button", label);

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await issuing()).toEqual(before);

    await tickAll();
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
