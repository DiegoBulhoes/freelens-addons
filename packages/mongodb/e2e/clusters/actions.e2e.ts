import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickMenuItem,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  hoverForTooltip,
  shownDrawer,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, openSuite, PATH, pagesOn } from "../support/mongodb";

// Read-only: every dialog is opened and cancelled; the clusters are compared before and after.

const ICONS: [icon: string, dialog: RegExp][] = [
  ["swap_horiz", /Make another member the primary/],
  ["unfold_more", /Change how many data members/],
  ["delete", /Delete catalog-rs\?/],
];

describe("a cluster's drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openSuite());
  }, 180_000);

  afterAll(() => session?.close());

  const { openRow } = pagesOn(() => ({ session, frame }));

  const toolbarIcon = (name: string) =>
    `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const specs = async () =>
    JSON.stringify(
      (await clusterItems<{ metadata: { name: string }; spec: unknown }>(session, frame, PATH))
        .map((each) => [each.metadata.name, each.spec])
        .sort(),
    );

  it("closes a member's menu once an item is picked, and keeps the drawer open", async () => {
    await openRow("catalog-rs");
    await session.evaluate(
      `document.querySelector('${DRAWER} [data-section="mongodb-members"] .MongoDB-row__actions i.Icon').click()`,
      frame,
    );
    await clickMenuItem(session, frame, "Restart");
    expect(await dialogText(session, frame)).toMatch(/catalog-rs-\d/);
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    expect(
      await waitFor(
        "the menu to close",
        async () =>
          (await session.evaluate<number>(
            `[...document.querySelectorAll('.MenuItem')].filter((each) => !each.closest('${DRAWER}')).length`,
            frame,
          )) === 0
            ? true
            : undefined,
        // The host's close animation is under a second; longer means it stayed open.
        5_000,
      ),
    ).toBe(true);
    expect(
      await countOf(session, frame, `${DRAWER} [data-section="mongodb-members"]`),
    ).toBeGreaterThan(0);

    await cancelDialog(session, frame);
  }, 60_000);

  it("asks before every title-bar action, in the theme's colours, and writes nothing when cancelled", async () => {
    const before = await specs();

    await openRow("catalog-rs");

    for (const [icon, question] of ICONS) {
      await session.evaluate(`${toolbarIcon(icon)}.setAttribute("data-hovered", "")`, frame);
      expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`), icon).toMatch(/\w/);
      await session.evaluate(
        `document.querySelector('${DRAWER} [data-hovered]')?.removeAttribute("data-hovered")`,
        frame,
      );

      await session.evaluate(`${toolbarIcon(icon)}.click()`, frame);

      expect(await dialogText(session, frame), icon).toMatch(question);
      expect(await dialogColourViolations(session, frame, "MongoDB"), icon).toEqual([]);

      await cancelDialog(session, frame);
    }

    expect(await specs()).toEqual(before);
  }, 120_000);

  it("plans a restart of every member with the primary last, and writes nothing when cancelled", async () => {
    const before = await specs();

    await openRow("catalog-rs");
    await waitFor("the roles", async () =>
      (await session.evaluate<boolean>(
        `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].some((each) => each.textContent.startsWith("Primary"))`,
        frame,
      ))
        ? true
        : undefined,
    );
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="mongodb-members"] button`,
      "Restart all",
    );

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(
      /In order: restart catalog-rs-\d, then restart catalog-rs-\d, then restart catalog-rs-\d, the primary\./,
    );
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await cancelDialog(session, frame);
    expect(await specs()).toEqual(before);
  }, 60_000);
  it("says what a size would do while it is typed, before anything is sent", async () => {
    const before = await specs();

    await openRow("catalog-rs");
    await session.evaluate(`${toolbarIcon("unfold_more")}.click()`, frame);
    await dialogText(session, frame);
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Data members"]', "2");

    const warnings = await waitFor(
      "the warnings",
      async () =>
        (await session.evaluate<string>(
          `[...document.querySelectorAll('.ConfirmDialog .MongoDB-text--warning')].map((each) => each.textContent).join(" ")`,
          frame,
        )) || undefined,
    );

    expect(warnings).toMatch(/Removes catalog-rs-2; their volumes are kept\./);
    expect(warnings).toMatch(/2 voting members can split evenly/);
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await cancelDialog(session, frame);
    expect(await specs()).toEqual(before);
  }, 60_000);

  it("draws all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
