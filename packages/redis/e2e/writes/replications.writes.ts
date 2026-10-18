import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  clickWhenShown,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  clickUndo,
  confirmDialog,
  notificationMatching,
  putBackWith,
  restore,
  startTime,
  untilCluster,
} from "../../../../build/e2e/writes";
import { DRAWER, GROUP, ready, readySince, redisWrites, role, uid } from "../support/redis";

describe("Redis writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;
  const putBack = putBackWith(onTestFinished);

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { get, js, openRow, pod, podsOf, resize, toolbar } = redisWrites(() => ({
    session,
    frame,
  }));

  // The replication is settled once every pod is ready and the operator has labelled each one.
  const settled = async () => {
    const pods = await podsOf("cache");
    const replication = await get(`${GROUP}/redisreplications/cache`);
    const master = pods.find((each) => role(each) === "master");

    return (
      pods.length === replication?.spec?.clusterSize &&
      pods.every((each) => ready(each) && role(each)) &&
      master !== undefined &&
      replication?.status?.masterNode === master.metadata.name
    );
  };

  it("fails cache over: another pod becomes master, in its label and the status", async () => {
    await untilCluster("cache to settle", settled);
    const before = (await get(`${GROUP}/redisreplications/cache`))?.status?.masterNode;

    await openRow("replications", "cache", "Replication");
    await toolbar("swap_horiz");
    await confirmDialog(session, frame, "Fail over", "cache");
    await notificationMatching(session, frame, /Failover of cache started/);

    const after = await untilCluster("a new master", async () => {
      const master = (await get(`${GROUP}/redisreplications/cache`))?.status?.masterNode;
      return master && master !== before && role(await pod(master)) === "master" ? master : false;
    });

    expect(after).not.toBe(before);
    await untilCluster("cache to settle", settled);
  });

  it("scales cache to 4, and Undo puts it back to 3", async () => {
    // Two cluster waits of up to five minutes each, past hookTimeout.
    putBack(async () => {
      await resize("redisreplications/cache", 3);
      // The operator may have started a fourth pod before the undo; its volume stays behind.
      await untilCluster(
        "cache back to three pods",
        async () => (await podsOf("cache")).length === 3,
      );
      await restore(
        session,
        frame,
        "DELETE",
        "/api/v1/namespaces/redis/persistentvolumeclaims/cache-cache-3",
      );
      await untilCluster("cache to settle", settled);
    }, 11 * 60_000);
    await openRow("replications", "cache", "Replication");
    await toolbar("unfold_more");
    await waitFor("the size field", async () =>
      (await js<number>(
        `document.querySelectorAll('.ConfirmDialog input[aria-label="Pods"]').length`,
      )) > 0
        ? true
        : undefined,
    );
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Pods"]', "4");
    await confirmDialog(session, frame, "Scale");
    await notificationMatching(session, frame, /cache scaled to 4/);
    await clickUndo(session, frame, /cache scaled to 4/);

    expect((await get(`${GROUP}/redisreplications/cache`))?.spec?.clusterSize).toBe(3);
  });

  it("restarts one replica of cache: a new pod, and the set settles", async () => {
    const replica = (await podsOf("cache")).find((each) => role(each) === "slave");
    const name: string = replica?.metadata.name;
    const before = uid(replica);

    expect(before, `${name} must have a uid before the restart`).toBeTruthy();

    await openRow("replications", "cache", "Replication");
    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="redis-nodes"] .Redis-row')].find((row) => row.querySelector("b")?.textContent === ${JSON.stringify(name)}).querySelector(".Redis-row__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, "Restart");
    await confirmDialog(session, frame, "Restart", name);
    await notificationMatching(session, frame, new RegExp(`Restart of ${name} requested`));

    // A new uid, not a later start time: the two clocks need not agree.
    await untilCluster(`${name} back`, async () => {
      const now = await pod(name);
      return uid(now) !== undefined && uid(now) !== before && ready(now);
    });
    await untilCluster("cache to settle", settled);
  });

  it("restarts every pod of cache, one at a time, with the master last", async () => {
    await untilCluster("cache to settle", settled);
    const pods = await podsOf("cache");
    const master: string = pods.find((each) => role(each) === "master")?.metadata.name;
    const before: Record<string, string | undefined> = Object.fromEntries(
      pods.map((each) => [each.metadata.name, uid(each)]),
    );

    await openRow("replications", "cache", "Replication");
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="redis-nodes"] button`,
      "Restart all",
    );
    await confirmDialog(session, frame, "Restart 3", "cache");
    expect(
      await notificationMatching(session, frame, /Restarting cache, one pod at a time/),
    ).toContain(`, then ${master}.`);
    await notificationMatching(session, frame, /Every pod of cache was restarted/, 15 * 60_000);

    const after = await podsOf("cache");
    const started: Record<string, number> = Object.fromEntries(
      after.map((each) => [each.metadata.name, startTime(each)]),
    );

    for (const [name, was] of Object.entries(before)) {
      expect(uid(after.find((each) => each.metadata.name === name)), name).not.toBe(was);
    }
    // Start times compared with each other only, all from the one API server.
    expect(Math.max(...Object.values(started))).toBe(started[master]);

    // One at a time: each pod started only once the one before it was Ready again.
    const order = [...after].sort((a, b) => startTime(a) - startTime(b));

    for (let at = 1; at < order.length; at += 1) {
      expect(startTime(order[at]), order[at]?.metadata.name).toBeGreaterThanOrEqual(
        readySince(order[at - 1]),
      );
    }
    await untilCluster("cache to settle", settled);
  });
});
