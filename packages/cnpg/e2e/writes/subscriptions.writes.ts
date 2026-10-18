import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { openWorkbench } from "../../../../build/e2e/freelens";
import {
  confirmDialog,
  notificationMatching,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { cnpgWrites, NS } from "../support/cnpg";

describe("CloudNativePG writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const { get, rowMenu, putBack } = cnpgWrites(() => ({ session, frame }));

  it("deletes the subscription orders-sub, keeping it in Postgres, and it is put back", async () => {
    const path = `${NS}/subscriptions/orders-sub`;
    const seeded = await get(path);

    if (!seeded) throw new Error("the seed has no orders-sub");

    putBack(async () => {
      await untilCluster("orders-sub's finalizer done", async () => {
        const left = await get(path);
        return left?.metadata.deletionTimestamp ? undefined : true;
      });
      if (await get(path)) return;

      await restore(
        session,
        frame,
        "POST",
        `${NS}/subscriptions`,
        {
          apiVersion: seeded.apiVersion,
          kind: seeded.kind,
          metadata: {
            name: seeded.metadata.name,
            namespace: seeded.metadata.namespace,
            labels: seeded.metadata.labels,
            annotations: seeded.metadata.annotations,
          },
          spec: seeded.spec,
        },
        "application/json",
      );
      await untilCluster(
        "orders-sub applied again",
        async () => (await get(path))?.status?.applied === true,
      );
    });
    await rowMenu("logical", "orders-sub", "Delete");
    const asked = await confirmDialog(session, frame, "Delete", "orders-sub");

    expect(asked).toMatch(/stays in Postgres, as its reclaim policy is retain/);
    await notificationMatching(session, frame, /Deleted subscription orders-sub/);
    await untilCluster("orders-sub gone", async () => !(await get(path)));
  });
});
