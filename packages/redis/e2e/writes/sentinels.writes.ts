import { afterAll, beforeAll, describe, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { openWorkbench, typeInto, waitFor } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  putBackWith,
  untilCluster,
} from "../../../../build/e2e/writes";
import { ready, redisWrites } from "../support/redis";

describe("Redis writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;
  const putBack = putBackWith(onTestFinished);

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { js, openRow, podsOf, resize, toolbar } = redisWrites(() => ({ session, frame }));

  it("scales the sentinels to 4 and back to 3", async () => {
    const scaleTo = async (count: number) => {
      await openRow("sentinels", "cache-sentinel", "Sentinel");
      await toolbar("unfold_more");
      await waitFor("the size field", async () =>
        (await js<number>(
          `document.querySelectorAll('.ConfirmDialog input[aria-label="Sentinels"]').length`,
        )) > 0
          ? true
          : undefined,
      );
      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Sentinels"]', String(count));
      await confirmDialog(session, frame, "Scale");
      await notificationMatching(session, frame, new RegExp(`cache-sentinel scaled to ${count}`));
    };
    const sentinels = async (count: number) => {
      const pods = await podsOf("cache-sentinel-sentinel");
      return pods.length === count && pods.every(ready);
    };

    putBack(async () => {
      await resize("redissentinels/cache-sentinel", 3);
    });
    await scaleTo(4);
    await untilCluster("a fourth sentinel, ready", () => sentinels(4));
    await scaleTo(3);
    await untilCluster("three sentinels again", () => sentinels(3));
  });
});
