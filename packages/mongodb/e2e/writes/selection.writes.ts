import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  putBackWith,
  untilCluster,
} from "../../../../build/e2e/writes";
import { LIST } from "../support/mongodb";
import { writesOn } from "../support/writes";

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

  const { js, uid, replaced, settled, restartedAt, putBackSecure, seedIntact } = writesOn(() => ({
    session,
    frame,
  }));

  // Past hookTimeout: each budget covers its step's own waits.
  const putBackSecureAfter = () => putBack(putBackSecure, 21 * 60_000);

  // A test that inherits an earlier one's leftovers fails here, naming them, not halfway through.
  beforeEach(seedIntact, 10 * 60_000);

  it("restarts secure-rs from its list, ticked: the operator rolls its pod", async () => {
    const before = await uid("secure-rs-0");

    expect(before, "secure-rs-0 must exist before the restart").toBeDefined();

    putBackSecureAfter();
    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("rows", async () =>
      (await js<number>(`document.querySelectorAll('${LIST} tbody tr').length`)) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => row.children[1]?.textContent.startsWith("secure-rs"))?.querySelector(".MongoDB-table__check input").click()`,
    );
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");
    await confirmDialog(session, frame, "Restart 1", "confirm");
    await notificationMatching(session, frame, /Restarted 1 of 1/);

    expect(await restartedAt("secure-rs")).toBeTruthy();
    await untilCluster("secure-rs-0 rolled", () => replaced("secure-rs-0", before), 10 * 60_000);
    await untilCluster("secure-rs to settle", () => settled("secure-rs"), 10 * 60_000);
  });
});
