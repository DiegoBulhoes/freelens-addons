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
  clusterObject,
  confirmDialog,
  execIn,
  type KubeObject,
  notificationMatching,
  restore,
  startTime,
  untilCluster,
} from "../../../build/e2e/writes";

const DRAWER = ".MongoDBObjectDrawer";
const LIST = '[data-section="mongodb-clusters"]';
const SETS = "/apis/mongodbcommunity.mongodb.com/v1/namespaces/mongodb/mongodbcommunity";
const PODS = "/api/v1/namespaces/mongodb/pods";
const HEALTH = "/var/log/mongodb-mms-automation/healthstatus/agent-health-status.json";
const PRIMARY = 1;

// catalog-rs: three members, catalog-rs-2 preferred primary (priorities 1, 1, 2). Every test
// leaves it that way, with every agent in its goal state.
describe("MongoDB writes, checked in the cluster", () => {
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());

  const js = <T>(code: string) => session.evaluate<T>(code, frame);
  const get = (path: string) => clusterObject(session, frame, path);
  const pod = (name: string) => get(`${PODS}/${name}`);
  const ready = (each: KubeObject | undefined) =>
    each?.status?.conditions?.some(
      (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
    ) === true;

  /** What the member's own agent says: its replication state and whether it has finished its plan. */
  const agent = async (member: string) => {
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

  const openSet = async (name: string) => {
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
      `[...(${openDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(icon)}).click()`,
    );

  const memberMenu = async (member: string, item: string) => {
    await js(
      `[...document.querySelectorAll('${DRAWER} [data-section="mongodb-members"] .MongoDB-row')].find((row) => row.querySelector("b")?.textContent === ${JSON.stringify(member)}).querySelector(".MongoDB-row__actions i.Icon").click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  it("switches the primary to catalog-rs-0, then back to catalog-rs-2 from its menu", async () => {
    await untilCluster("catalog-rs to settle", () => settled("catalog-rs", "catalog-rs-2"));

    await openSet("catalog-rs");
    await toolbar("swap_horiz");
    await clickByText(session, frame, ".ConfirmDialog button.MongoDB-filter", "catalog-rs-0");
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

  it("scales catalog-rs to 4 members and back to 3", async () => {
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

    // Scaling down keeps the volumes, as the dialog says.
    for (const volume of ["data-volume", "logs-volume"]) {
      await restore(
        session,
        frame,
        "DELETE",
        `/api/v1/namespaces/mongodb/persistentvolumeclaims/${volume}-catalog-rs-3`,
      );
    }
  });

  it("restarts the secondary catalog-rs-0: a new pod, and the set settles", async () => {
    const before = startTime(await pod("catalog-rs-0"));

    await openSet("catalog-rs");
    await memberMenu("catalog-rs-0", "Restart");
    await confirmDialog(session, frame, "Restart", "catalog-rs-0");
    await notificationMatching(session, frame, /Restart of catalog-rs-0 requested/);

    await untilCluster(
      "catalog-rs-0 back",
      async () => startTime(await pod("catalog-rs-0")) > before,
    );
    await untilCluster("catalog-rs to settle", () => settled("catalog-rs", "catalog-rs-2"));
  });

  it("restarts every member of catalog-rs, the primary last, and it is primary again", async () => {
    await untilCluster("catalog-rs to settle", () => settled("catalog-rs", "catalog-rs-2"));
    const names = await members("catalog-rs");
    const before: Record<string, number> = {};
    for (const name of names) before[name] = startTime(await pod(name));

    await openSet("catalog-rs");
    // The drawer reads the agents every 15s: until it sees them settled, Restart all refuses.
    await waitFor(
      "Restart all to be accepted",
      async () => {
        const open = await js<number>(`document.querySelectorAll(".ConfirmDialog").length`);

        if (open > 0) return true;
        await clickByText(
          session,
          frame,
          `${DRAWER} [data-section="mongodb-members"] button`,
          "Restart all",
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return undefined;
      },
      60_000,
    );
    await confirmDialog(session, frame, "Restart 3", "catalog-rs");
    await notificationMatching(
      session,
      frame,
      /Every member of catalog-rs was restarted/,
      20 * 60_000,
    );

    const after: Record<string, number> = {};
    for (const name of names) after[name] = startTime(await pod(name));

    for (const name of names) expect(after[name], name).toBeGreaterThan(before[name] ?? 0);
    expect(Math.max(...Object.values(after))).toBe(after["catalog-rs-2"]);
    await untilCluster("catalog-rs-2 primary again", () => settled("catalog-rs", "catalog-rs-2"));
  });

  it("restarts secure-rs from its list, ticked: the operator rolls its pod", async () => {
    const before = startTime(await pod("secure-rs-0"));

    expect(before, "secure-rs-0 must exist before the restart").toBeGreaterThan(0);

    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("rows", async () =>
      (await js<number>(`document.querySelectorAll('${LIST} tbody tr').length`)) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => row.children[1]?.textContent.startsWith("secure-rs"))?.querySelector(".MongoDB-table__check input").click()`,
    );
    await clickByText(session, frame, '[data-section="selection"] button', "Restart");
    await confirmDialog(session, frame, "Restart 1", "confirm");
    await notificationMatching(session, frame, /Restarted 1 of 1/);

    expect(
      (await get(`${SETS}/secure-rs`))?.spec?.statefulSet?.spec?.template?.metadata?.annotations?.[
        "mongodb.com/restartedAt"
      ],
    ).toBeTruthy();
    await untilCluster(
      "secure-rs-0 rolled",
      async () => startTime(await pod("secure-rs-0")) > before,
      10 * 60_000,
    );
    await untilCluster("secure-rs to settle", () => settled("secure-rs"), 10 * 60_000);

    // The seed's override has no restart annotation; removing it rolls the pod once more.
    await restore(
      session,
      frame,
      "PATCH",
      `${SETS}/secure-rs`,
      [
        {
          op: "remove",
          path: "/spec/statefulSet/spec/template/metadata/annotations/mongodb.com~1restartedAt",
        },
      ],
      "application/json-patch+json",
    );
    await untilCluster("secure-rs to settle again", () => settled("secure-rs"), 10 * 60_000);
  });
});
