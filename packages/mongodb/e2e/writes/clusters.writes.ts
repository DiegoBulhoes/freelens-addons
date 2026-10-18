import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { openWorkbench, pressChip, typeInto, waitFor } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  putBackWith,
  untilCluster,
} from "../../../../build/e2e/writes";
import { DRAWER } from "../support/mongodb";
import { PVCS, SETS, writesOn } from "../support/writes";

// catalog-rs: three members, catalog-rs-2 preferred primary (priorities 1, 1, 2). Every test
// starts from that, checked, and puts it back whether it passed or not.
describe("MongoDB writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;
  const putBack = putBackWith(onTestFinished);

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const {
    js,
    get,
    pod,
    settled,
    priorities,
    openSet,
    toolbar,
    memberMenu,
    putBackCatalog,
    seedIntact,
  } = writesOn(() => ({ session, frame }));

  // Past hookTimeout: each budget covers its step's own waits.
  const putBackCatalogAfter = () => putBack(putBackCatalog, 21 * 60_000);

  // A test that inherits an earlier one's leftovers fails here, naming them, not halfway through.
  beforeEach(seedIntact, 10 * 60_000);

  it("switches the primary to catalog-rs-0, then back to catalog-rs-2 from its menu", async () => {
    putBackCatalogAfter();
    await openSet("catalog-rs");
    await toolbar("swap_horiz");
    await pressChip(session, frame, ".ConfirmDialog button.MongoDB-filter", "catalog-rs-0");
    await confirmDialog(session, frame, "Switch", "catalog-rs");
    await notificationMatching(
      session,
      frame,
      /catalog-rs-0 will be elected primary of catalog-rs/,
    );

    expect(await priorities("catalog-rs")).toEqual(["2", "1", "1"]);
    await untilCluster("catalog-rs-0 elected", () => settled("catalog-rs", "catalog-rs-0"));

    await openSet("catalog-rs");
    // "Make primary" is offered only once the row shows catalog-rs-2 as a secondary.
    await waitFor(
      "catalog-rs-0 primary and catalog-rs-2 secondary on screen",
      async () =>
        (await js<boolean>(
          `(() => {
            const rows = [...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')];
            const role = (name) => rows.find((row) => row.querySelector("b")?.textContent === name)?.textContent ?? "";
            return role("catalog-rs-0").startsWith("Primary") && role("catalog-rs-2").startsWith("Secondary");
          })()`,
        )) || undefined,
      90_000,
    );
    await memberMenu("catalog-rs-2", "Make primary");
    await confirmDialog(session, frame, "Switch", "catalog-rs");

    expect(await priorities("catalog-rs")).toEqual(["1", "1", "2"]);
    await untilCluster("catalog-rs-2 elected again", () => settled("catalog-rs", "catalog-rs-2"));
  });

  it(
    "scales catalog-rs to 4 members and back to 3",
    async () => {
      const scaleTo = async (count: number) => {
        await openSet("catalog-rs");
        await toolbar("unfold_more");
        await waitFor("the size field", async () =>
          (await js<number>(
            `document.querySelectorAll('.ConfirmDialog input[aria-label="Data members"]').length`,
          )) > 0
            ? true
            : undefined,
        );
        await typeInto(
          session,
          frame,
          '.ConfirmDialog input[aria-label="Data members"]',
          String(count),
        );
        await confirmDialog(session, frame, "Scale");
        await notificationMatching(session, frame, new RegExp(`catalog-rs scaled to ${count}`));
      };

      putBackCatalogAfter();
      await scaleTo(4);
      await untilCluster(
        "a fourth member in its goal state",
        async () =>
          (await get(`${SETS}/catalog-rs`))?.status?.currentMongoDBMembers === 4 &&
          settled("catalog-rs", "catalog-rs-2"),
        10 * 60_000,
      );
      expect(await priorities("catalog-rs")).toEqual(["1", "1", "2", "1"]);

      await scaleTo(3);
      await untilCluster(
        "three members again",
        async () =>
          (await get(`${SETS}/catalog-rs`))?.status?.currentMongoDBMembers === 3 &&
          (await pod("catalog-rs-3")) === undefined &&
          settled("catalog-rs", "catalog-rs-2"),
        10 * 60_000,
      );
      expect(await priorities("catalog-rs")).toEqual(["1", "1", "2"]);
      // Scaling down keeps the volumes, as the dialog says; putBackCatalog deletes them.
      expect(await get(`${PVCS}/data-volume-catalog-rs-3`)).toBeDefined();
    },
    25 * 60_000,
  );
});
