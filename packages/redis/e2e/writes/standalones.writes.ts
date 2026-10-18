import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clickWhenShown,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { confirmDialog, notificationMatching, untilCluster } from "../../../../build/e2e/writes";
import { ready, redisWrites, uid } from "../support/redis";

describe("Redis writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { js, pod } = redisWrites(() => ({ session, frame }));

  it("restarts the standalone sessions from its list, ticked", async () => {
    const before = uid(await pod("sessions-0"));

    expect(before, "sessions-0 must exist before the restart").toBeTruthy();

    await clickSidebar(session, frame, "redis-standalones", "redis");
    await waitFor("rows", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="redis-standalones"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="redis-standalones"] tbody tr')].find((row) => row.querySelector("td:not(.Redis-table__check)")?.textContent.startsWith("sessions"))?.querySelector(".Redis-table__check input").click()`,
    );
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");
    await confirmDialog(session, frame, "Restart 1", "confirm");
    await notificationMatching(
      session,
      frame,
      /Restarting sessions, one pod at a time: sessions-0\./,
    );
    await notificationMatching(session, frame, /Restarted 1 of 1/, 10 * 60_000);

    await untilCluster("sessions back", async () => {
      const now = await pod("sessions-0");
      return uid(now) !== undefined && uid(now) !== before && ready(now);
    });
  });
});
