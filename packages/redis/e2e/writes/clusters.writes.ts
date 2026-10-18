import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { openWorkbench, typeInto, waitFor } from "../../../../build/e2e/freelens";
import {
  clickUndo,
  confirmDialog,
  execIn,
  notificationMatching,
  putBackWith,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { GROUP, redisWrites } from "../support/redis";

describe("Redis writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;
  const putBack = putBackWith(onTestFinished);

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { get, js, openRow, podsOf, resize, toolbar } = redisWrites(() => ({ session, frame }));

  // A restarted cluster pod breaks the cluster, so a scale must leave every node known and serving.
  const shardsWhole = async (leaders: number) => {
    const shards = await get(`${GROUP}/redisclusters/shards`);
    const info = await execIn(session, frame, "redis", "shards-leader-0", "shards-leader", [
      "sh",
      "-c",
      'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" cluster info',
    ]).catch(() => "");

    return (
      shards?.status?.state === "Ready" &&
      shards?.status?.readyLeaderReplicas === leaders &&
      shards?.status?.readyFollowerReplicas === leaders &&
      (await podsOf("shards-leader")).length === leaders &&
      (await podsOf("shards-follower")).length === leaders &&
      info.includes("cluster_state:ok") &&
      info.includes("cluster_slots_assigned:16384") &&
      info.includes(`cluster_known_nodes:${leaders * 2}`)
    );
  };

  const scaleShards = async (count: number) => {
    await openRow("clusters", "shards", "Cluster");
    await toolbar("unfold_more");
    await waitFor("the size field", async () =>
      (await js<number>(
        `document.querySelectorAll('.ConfirmDialog input[aria-label^="Leaders"]').length`,
      )) > 0
        ? true
        : undefined,
    );
    await typeInto(session, frame, '.ConfirmDialog input[aria-label^="Leaders"]', String(count));
    await confirmDialog(session, frame, "Scale");
    await notificationMatching(session, frame, new RegExp(`shards scaled to ${count}`));
  };

  // The volumes of a fourth leader and follower outlive the scale-down; the seed has none.
  const dropFourthVolumes = async () => {
    for (const set of ["shards-leader", "shards-follower"]) {
      for (const claim of [`${set}-${set}-3`, `node-conf-${set}-3`]) {
        await restore(
          session,
          frame,
          "DELETE",
          `/api/v1/namespaces/redis/persistentvolumeclaims/${claim}`,
        );
      }
    }
  };

  it(
    "scales shards to 4, and Undo puts it back to 3 with every node known",
    async () => {
      await untilCluster("shards whole", () => shardsWhole(3), 10 * 60_000);

      // Past hookTimeout: the step waits up to 15 min for the cluster to be whole.
      putBack(async () => {
        await resize("redisclusters/shards", 3);
        await dropFourthVolumes();
        await untilCluster("shards whole again", () => shardsWhole(3), 15 * 60_000);
      }, 16 * 60_000);
      await scaleShards(4);
      await clickUndo(session, frame, /shards scaled to 4/);

      expect((await get(`${GROUP}/redisclusters/shards`))?.spec?.clusterSize).toBe(3);

      await untilCluster("shards whole again", () => shardsWhole(3), 15 * 60_000);
    },
    30 * 60_000,
  );

  it(
    "scales shards to 4 and back to 3: slots move, and no node is left behind",
    async () => {
      await untilCluster("shards whole", () => shardsWhole(3), 10 * 60_000);

      // Past hookTimeout: the step waits up to 15 min for the cluster to be whole.
      putBack(async () => {
        await resize("redisclusters/shards", 3);
        await dropFourthVolumes();
        await untilCluster("shards whole again", () => shardsWhole(3), 15 * 60_000);
      }, 16 * 60_000);
      await scaleShards(4);
      await untilCluster("shards whole with 4 leaders", () => shardsWhole(4), 15 * 60_000);
      await scaleShards(3);
      await untilCluster("shards whole with 3 leaders", () => shardsWhole(3), 15 * 60_000);
    },
    45 * 60_000,
  );
});
