import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import {
  clickByText,
  clickSidebar,
  drawerTitle,
  openDrawer,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";
import {
  clickUndo,
  clusterObject,
  confirmDialog,
  type KubeObject,
  notificationMatching,
  restore,
  startTime,
  untilCluster,
} from "../../../build/e2e/writes";

const DRAWER = ".RedisObjectDrawer";
const GROUP = "/apis/redis.redis.opstreelabs.in/v1beta2/namespaces/redis";
const PODS = "/api/v1/namespaces/redis/pods";

describe("Redis writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const get = (path: string) => clusterObject(session, frame, path);
  const pod = (name: string) => get(`${PODS}/${name}`);
  const podsOf = async (app: string) =>
    ((await get(`${PODS}?labelSelector=app%3D${app}`))?.items ?? []) as KubeObject[];
  const ready = (each: KubeObject | undefined) =>
    each?.status?.conditions?.some(
      (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
    ) === true;
  const role = (each: KubeObject | undefined) => each?.metadata?.labels?.["redis-role"];

  const openRow = async (page: string, name: string, kind: string) => {
    await clickSidebar(session, frame, `redis-${page}`, "redis");
    await waitFor("rows", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="redis-${page}"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="redis-${page}"] tbody tr')].find((row) => row.children[1]?.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:nth-child(2)").click()`,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `${kind}: ${name}` ? true : undefined,
    );
  };

  const toolbar = (icon: string) =>
    js(
      `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(icon)}).click()`,
    );

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
  });

  it("restarts one replica of cache: a new pod, and the set settles", async () => {
    const replica = (await podsOf("cache")).find((each) => role(each) === "slave");
    const name: string = replica?.metadata.name;
    const before = startTime(replica);

    await openRow("replications", "cache", "Replication");
    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="redis-nodes"] .Redis-row')].find((row) => row.querySelector("b")?.textContent === ${JSON.stringify(name)}).querySelector(".Redis-row__actions i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", "Restart");
    await confirmDialog(session, frame, "Restart", name);
    await notificationMatching(session, frame, new RegExp(`Restart of ${name} requested`));

    await untilCluster(`${name} back`, async () => {
      const now = await pod(name);
      return startTime(now) > before && ready(now);
    });
    await untilCluster("cache to settle", settled);
  });

  it("restarts every pod of cache, one at a time, with the master last", async () => {
    await untilCluster("cache to settle", settled);
    const pods = await podsOf("cache");
    const master: string = pods.find((each) => role(each) === "master")?.metadata.name;
    const before: Record<string, number> = Object.fromEntries(
      pods.map((each) => [each.metadata.name, startTime(each)]),
    );

    await openRow("replications", "cache", "Replication");
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="redis-nodes"] button`,
      "Restart all",
    );
    await confirmDialog(session, frame, "Restart 3", "cache");
    await notificationMatching(session, frame, /Every pod of cache was restarted/, 15 * 60_000);

    const after = await podsOf("cache");
    const started: Record<string, number> = Object.fromEntries(
      after.map((each) => [each.metadata.name, startTime(each)]),
    );

    for (const [name, time] of Object.entries(before))
      expect(started[name], name).toBeGreaterThan(time);
    expect(Math.max(...Object.values(started))).toBe(started[master]);
    await untilCluster("cache to settle", settled);
  });

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

    await scaleTo(4);
    await untilCluster("a fourth sentinel, ready", () => sentinels(4));
    await scaleTo(3);
    await untilCluster("three sentinels again", () => sentinels(3));
  });

  it("restarts the standalone sessions from its list, ticked", async () => {
    const before = startTime(await pod("sessions-0"));

    expect(before, "sessions-0 must exist before the restart").toBeGreaterThan(0);

    await clickSidebar(session, frame, "redis-standalones", "redis");
    await waitFor("rows", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="redis-standalones"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="redis-standalones"] tbody tr')].find((row) => row.children[1]?.textContent.startsWith("sessions"))?.querySelector(".Redis-table__check input").click()`,
    );
    await clickByText(session, frame, '[data-section="selection"] button', "Restart");
    await confirmDialog(session, frame, "Restart 1", "confirm");
    await notificationMatching(session, frame, /Restarted 1 of 1/, 10 * 60_000);

    await untilCluster("sessions back", async () => {
      const now = await pod("sessions-0");
      return startTime(now) > before && ready(now);
    });
  });
});
