import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import { type ErrorLog, shownDrawer, waitFor } from "../../../../build/e2e/freelens";
import { DRAWER, openSuite, pagesOn } from "../support/mongodb";

// Read-only: the drawer is opened and read.

describe("a cluster's drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openSuite());
  }, 180_000);

  afterAll(() => session?.close());

  const { openRow } = pagesOn(() => ({ session, frame }));

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

  const memberRows = () =>
    session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].map((each) => each.textContent)`,
      frame,
    );

  const drawerText = () =>
    session.evaluate<string>(`${shownDrawer(DRAWER)}?.textContent ?? ""`, frame);

  it("explains the member an upgrade stopped at, beside the one still serving", async () => {
    await openRow("upgrade-rs");

    const rows = await waitFor("the member's cause", async () => {
      const each = await memberRows();

      return each.some(
        (row) => row.includes("upgrade-rs-1") && /ErrImagePull|ImagePullBackOff/.test(row),
      )
        ? each
        : undefined;
    });

    expect(rows.find((row) => row.includes("upgrade-rs-1"))).toMatch(/Not ready/);
    expect(rows.find((row) => row.includes("upgrade-rs-0"))).toMatch(/Ready/);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
  }, 60_000);

  it("draws a member that cannot be scheduled beside the two still serving", async () => {
    await openRow("ledger-rs");

    const rows = await waitFor("ledger-rs-2's cause", async () => {
      const each = await memberRows();

      return each.some((row) => row.includes("ledger-rs-2") && /Not ready/.test(row))
        ? each
        : undefined;
    });

    expect(rows.filter((row) => !/Not ready/.test(row))).toHaveLength(2);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
  }, 60_000);

  it.each([
    ["sessions-rs", /1 arbiter/],
    ["secure-rs", /CA/],
    ["reporting-rs", /password Secret reporting-password does not exist/],
  ])(
    "draws %s's state within the standard",
    async (name, fact) => {
      await openRow(name);

      expect(
        await waitFor(`${name}'s facts`, async () => {
          const text = await drawerText();

          return fact.test(text) ? text : undefined;
        }),
      ).toMatch(fact);
      expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
    },
    60_000,
  );

  it("reads a failing cluster's warnings from its namespace, and draws them within the standard", async () => {
    await openRow("legacy-rs");

    const warning = await waitFor(
      "its warnings",
      async () =>
        (await session.evaluate<string>(
          `${shownDrawer(DRAWER)}?.querySelector('[data-section="mongodb-warnings"] .MongoDB-row--warning')?.textContent ?? ""`,
          frame,
        )) || undefined,
    );

    expect(warning).toMatch(/legacy-rs/);
    expect(await designViolations(session, frame, "MongoDB")).toEqual([]);
  }, 60_000);

  it("offers the operator's log, found by its image, among the commands", async () => {
    await openRow("catalog-rs");

    const labels = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-commands"] .MongoDB-row__name')].map((each) => each.textContent)`,
      frame,
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        "What each member's agent is doing",
        "The operator's log for it, wherever the operator runs",
      ]),
    );
  }, 60_000);

  it("draws all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
