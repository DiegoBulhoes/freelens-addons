import { expect } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickMenuItem,
  clickSidebar,
  drawerTitle,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  clusterObject,
  execIn,
  type KubeObject,
  restore,
  untilCluster,
} from "../../../../build/e2e/writes";
import { DRAWER, LIST } from "./mongodb";

export const SETS = "/apis/mongodbcommunity.mongodb.com/v1/namespaces/mongodb/mongodbcommunity";
const PODS = "/api/v1/namespaces/mongodb/pods";
export const PVCS = "/api/v1/namespaces/mongodb/persistentvolumeclaims";
const HEALTH = "/var/log/mongodb-mms-automation/healthstatus/agent-health-status.json";
const PRIMARY = 1;
const PREFERRED = [
  { votes: 1, priority: "1" },
  { votes: 1, priority: "1" },
  { votes: 1, priority: "2" },
];

export const writesOn = (at: () => { session: Session; frame: number }) => {
  const js = <T>(code: string) => {
    const { session, frame } = at();

    return session.evaluate<T>(code, frame);
  };
  const get = (path: string) => {
    const { session, frame } = at();

    return clusterObject(session, frame, path);
  };
  const pod = (name: string) => get(`${PODS}/${name}`);
  const ready = (each: KubeObject | undefined) =>
    each?.status?.conditions?.some(
      (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
    ) === true;
  // A pod deleted comes back under the same name; only its uid tells the new one from the old.
  const uid = async (name: string): Promise<string | undefined> => (await pod(name))?.metadata?.uid;
  const replaced = async (name: string, before: string | undefined) => {
    const now = await pod(name);

    return now?.metadata?.uid !== undefined && now.metadata.uid !== before && ready(now);
  };

  /** What the member's own agent says: its replication state and whether it has finished its plan. */
  const agent = async (member: string) => {
    const { session, frame } = at();
    const health = JSON.parse(
      await execIn(session, frame, "mongodb", member, "mongodb-agent", ["cat", HEALTH]),
    ) as { statuses?: Record<string, { ReplicationStatus?: number; IsInGoalState?: boolean }> };

    return health.statuses?.[member];
  };

  const members = async (name: string) => {
    const set = await get(`${SETS}/${name}`);
    return Array.from({ length: set?.spec?.members ?? 0 }, (_, index) => `${name}-${index}`);
  };

  /** Running, every member ready and in its goal state, and the expected one primary. */
  const settled = async (name: string, primary?: string) => {
    if ((await get(`${SETS}/${name}`))?.status?.phase !== "Running") return false;

    for (const member of await members(name)) {
      if (!ready(await pod(member))) return false;

      const health = await agent(member).catch(() => undefined);

      if (!health?.IsInGoalState) return false;
      if (primary && member === primary && health.ReplicationStatus !== PRIMARY) return false;
    }

    return true;
  };

  const priorities = async (name: string) =>
    ((await get(`${SETS}/${name}`))?.spec?.memberConfig ?? []).map(
      (each: KubeObject) => each.priority,
    );

  const restartedAt = async (name: string) =>
    (await get(`${SETS}/${name}`))?.spec?.statefulSet?.spec?.template?.metadata?.annotations?.[
      "mongodb.com/restartedAt"
    ];

  // Each step is a no-op on the seed, so this also runs after a write that never happened.
  const putBackCatalog = async () => {
    const { session, frame } = at();

    await restore(session, frame, "PATCH", `${SETS}/catalog-rs`, {
      spec: { members: 3, memberConfig: PREFERRED },
    });
    await untilCluster(
      "catalog-rs-3 gone",
      async () => (await pod("catalog-rs-3")) === undefined,
      10 * 60_000,
    );
    for (const volume of ["data-volume", "logs-volume"]) {
      await restore(session, frame, "DELETE", `${PVCS}/${volume}-catalog-rs-3`);
    }
    await untilCluster(
      "catalog-rs settled on catalog-rs-2",
      () => settled("catalog-rs", "catalog-rs-2"),
      10 * 60_000,
    );
  };

  // The seed's override has no restart annotation; removing one rolls the pod once more.
  const putBackSecure = async () => {
    const { session, frame } = at();

    if ((await restartedAt("secure-rs")) !== undefined) {
      const before = await uid("secure-rs-0");

      await restore(session, frame, "PATCH", `${SETS}/secure-rs`, {
        spec: {
          statefulSet: {
            spec: { template: { metadata: { annotations: { "mongodb.com/restartedAt": null } } } },
          },
        },
      });
      // Settled holds before the operator starts that roll; wait for the new pod first.
      await untilCluster(
        "secure-rs-0 rolled back",
        () => replaced("secure-rs-0", before),
        10 * 60_000,
      );
    }
    await untilCluster("secure-rs to settle", () => settled("secure-rs"), 10 * 60_000);
  };

  const seedIntact = async () => {
    const catalog = await get(`${SETS}/catalog-rs`);

    expect(catalog?.spec?.members, "catalog-rs members").toBe(3);
    expect(
      (catalog?.spec?.memberConfig ?? []).map(({ votes, priority }: KubeObject) => ({
        votes,
        priority,
      })),
      "catalog-rs memberConfig",
    ).toEqual(PREFERRED);
    expect(await pod("catalog-rs-3"), "a catalog-rs-3 pod").toBeUndefined();
    expect(await get(`${PVCS}/data-volume-catalog-rs-3`), "a catalog-rs-3 volume").toBeUndefined();
    expect(await restartedAt("secure-rs"), "secure-rs's restart annotation").toBeUndefined();
    await untilCluster("catalog-rs to settle", () => settled("catalog-rs", "catalog-rs-2"));
  };

  const openSet = async (name: string) => {
    const { session, frame } = at();

    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("rows", async () =>
      (await js<number>(`document.querySelectorAll('${LIST} tbody tr').length`)) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => row.children[1]?.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:nth-child(2)").click()`,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `Cluster: ${name}` ? true : undefined,
    );
    // The roles come from the agents, read every 15s: the writes are refused until they show.
    await waitFor(
      "the members' roles",
      async () =>
        (await js<boolean>(
          `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].some((row) => row.textContent.startsWith("Primary"))`,
        )) || undefined,
      60_000,
    );
  };

  const toolbar = (icon: string) =>
    js(
      `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(icon)}).click()`,
    );

  const memberMenu = async (member: string, item: string) => {
    const { session, frame } = at();

    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].find((row) => row.querySelector("b")?.textContent === ${JSON.stringify(member)}).querySelector(".MongoDB-row__actions i.Icon").click()`,
    );
    await clickMenuItem(session, frame, item);
  };

  return {
    js,
    get,
    pod,
    ready,
    uid,
    replaced,
    agent,
    members,
    settled,
    priorities,
    restartedAt,
    putBackCatalog,
    putBackSecure,
    seedIntact,
    openSet,
    toolbar,
    memberMenu,
  };
};
