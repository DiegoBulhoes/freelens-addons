import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  drawerTitle,
  hoverForTooltip,
  openDrawer,
  openWorkbench,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: every dialog is opened and cancelled; the clusters are compared before and after.

const DRAWER = ".MongoDBObjectDrawer";
const LIST = '[data-section="mongodb-clusters"]';
const PATH = "/apis/mongodbcommunity.mongodb.com/v1/mongodbcommunity";

const ICONS: [icon: string, dialog: RegExp][] = [
  ["swap_horiz", /Make another member the primary/],
  ["unfold_more", /Change how many data members/],
  ["delete", /Delete catalog-rs\?/],
];

describe("a cluster's drawer", () => {
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

  const toolbarIcon = (name: string) =>
    `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const specs = async () =>
    JSON.stringify(
      (await clusterItems<{ metadata: { name: string }; spec: unknown }>(session, frame, PATH))
        .map((each) => [each.metadata.name, each.spec])
        .sort(),
    );

  const openRow = async (name: string) => {
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("the clusters", async () =>
      (await countOf(`${LIST} tbody tr`)) > 0 ? true : undefined,
    );
    // The second cell: the first holds the row's checkbox, which opens nothing.
    await session.evaluate(
      `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => row.textContent.includes(${JSON.stringify(name)}))?.querySelector("td:nth-child(2)").click()`,
      frame,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `Cluster: ${name}` &&
      (await countOf(`${DRAWER} [data-section="mongodb-members"]`)) > 0
        ? true
        : undefined,
    );
  };

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  it("opens from a row with its facts, and marks the primary and the preferred member", async () => {
    await openRow("catalog-rs");

    const terms = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} .MongoDB-facts dt')].map((each) => each.textContent)`,
      frame,
    );

    expect(terms).toEqual(
      expect.arrayContaining(["Primary", "Version", "Feature compatibility", "TLS", "Connection"]),
    );

    const members = await waitFor("the members' roles", async () => {
      const rows = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].map((each) => each.textContent)`,
        frame,
      );

      return rows.some((each) => each.startsWith("Primary")) ? rows : undefined;
    });

    expect(members.filter((each) => each.startsWith("Primary"))).toHaveLength(1);
    expect(members.filter((each) => each.startsWith("Secondary")).length).toBeGreaterThan(0);
    expect(members.find((each) => each.includes("preferred primary"))).toMatch(/^Primary/);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
  }, 90_000);

  it("closes a member's menu once an item is picked, and keeps the drawer open", async () => {
    await openRow("catalog-rs");
    await session.evaluate(
      `document.querySelector('${DRAWER} [data-section="mongodb-members"] .MongoDB-row__actions i.Icon').click()`,
      frame,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", "Restart");
    await dialogText();

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
    expect(await countOf(`${DRAWER} [data-section="mongodb-members"]`)).toBeGreaterThan(0);

    await cancelDialog();
  }, 60_000);

  it("explains a member that cannot start", async () => {
    await openRow("upgrade-rs");

    const reason = await waitFor("the member's cause", async () => {
      const text = await session.evaluate<string>(
        `document.querySelector('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')?.textContent ?? ""`,
        frame,
      );

      return /ImagePullBackOff/.test(text) ? text : undefined;
    });

    expect(reason).toMatch(/Not ready/);
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

      expect(await dialogText(), icon).toMatch(question);
      expect(await dialogColourViolations(session, frame, "MongoDB"), icon).toEqual([]);

      await cancelDialog();
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
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="mongodb-members"] button`,
      "Restart all",
    );

    const dialog = await dialogText();

    expect(dialog).toMatch(
      /In order: restart catalog-rs-\d, then restart catalog-rs-\d, then restart catalog-rs-\d, the primary\./,
    );
    expect(await dialogColourViolations(session, frame, "MongoDB")).toEqual([]);

    await cancelDialog();
    expect(await specs()).toEqual(before);
  }, 60_000);
});
