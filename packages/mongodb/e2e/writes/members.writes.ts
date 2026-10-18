import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { clickUntilDialog, openWorkbench } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  putBackWith,
  untilCluster,
} from "../../../../build/e2e/writes";
import { DRAWER } from "../support/mongodb";
import { SETS, writesOn } from "../support/writes";

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
    uid,
    replaced,
    members,
    settled,
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

  it("restarts the secondary catalog-rs-0: a new pod, and the set settles", async () => {
    const before = await uid("catalog-rs-0");

    putBackCatalogAfter();
    await openSet("catalog-rs");
    await memberMenu("catalog-rs-0", "Restart");
    await confirmDialog(session, frame, "Restart", "catalog-rs-0");
    await notificationMatching(session, frame, /Restart of catalog-rs-0 requested/);

    await untilCluster("catalog-rs-0 back", () => replaced("catalog-rs-0", before));
    await untilCluster("catalog-rs to settle", () => settled("catalog-rs", "catalog-rs-2"));
  });

  it(
    "restarts every member of catalog-rs, the primary last, and refuses other writes meanwhile",
    async () => {
      const names = await members("catalog-rs");
      const before: Record<string, string | undefined> = {};
      for (const name of names) before[name] = await uid(name);

      putBackCatalogAfter();
      await openSet("catalog-rs");
      // The drawer reads the agents every 15s: until it sees them settled, Restart all refuses.
      await clickUntilDialog(
        session,
        frame,
        `${DRAWER} [data-section="mongodb-members"] button`,
        "Restart all",
      );
      await confirmDialog(session, frame, "Restart 3", "catalog-rs");
      await notificationMatching(session, frame, /Restarting catalog-rs, one member at a time/);

      // While it runs, a scale could take one more member down: refused before any dialog opens.
      await toolbar("unfold_more");
      await notificationMatching(
        session,
        frame,
        /Restart all is still running on catalog-rs; wait for it to end\./,
      );
      expect(await js<number>(`document.querySelectorAll(".ConfirmDialog").length`)).toBe(0);
      expect((await get(`${SETS}/catalog-rs`))?.spec?.members).toBe(3);

      await notificationMatching(
        session,
        frame,
        /Every member of catalog-rs was restarted/,
        20 * 60_000,
      );

      for (const name of names) expect(await replaced(name, before[name]), name).toBe(true);
      // The primary went last: its pod is the newest, by the server's own clock.
      const created = async (name: string) =>
        Date.parse((await pod(name))?.metadata?.creationTimestamp ?? "") || 0;
      const newest = Math.max(...(await Promise.all(names.map(created))));
      expect(await created("catalog-rs-2")).toBe(newest);
      await untilCluster("catalog-rs-2 primary again", () => settled("catalog-rs", "catalog-rs-2"));
    },
    30 * 60_000,
  );
});
