import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  countOf,
  drawerTitle,
  shownDrawer,
  waitFor,
} from "../../../../build/e2e/freelens";
import { clusterObject, type KubeObject, restore } from "../../../../build/e2e/writes";

export const DRAWER = ".RedisObjectDrawer";
export const PATH = "/apis/redis.redis.opstreelabs.in/v1beta2/redisreplications";
export const GROUP = "/apis/redis.redis.opstreelabs.in/v1beta2/namespaces/redis";
export const PODS = "/api/v1/namespaces/redis/pods";

type Context = () => { session: Session; frame: number };

export const ready = (each: KubeObject | undefined) =>
  each?.status?.conditions?.some(
    (condition: KubeObject) => condition.type === "Ready" && condition.status === "True",
  ) === true;
export const role = (each: KubeObject | undefined) => each?.metadata?.labels?.["redis-role"];
export const uid = (each: KubeObject | undefined): string | undefined => each?.metadata?.uid;
export const readySince = (each: KubeObject | undefined): number =>
  Date.parse(
    each?.status?.conditions?.find((condition: KubeObject) => condition.type === "Ready")
      ?.lastTransitionTime ?? "",
  ) || 0;

export const redisDrawer = (context: Context) => {
  const toolbarIcon = (name: string) =>
    `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const specs = async () => {
    const { session, frame } = context();

    return JSON.stringify(
      (await clusterItems<{ metadata: { name: string }; spec: unknown }>(session, frame, PATH))
        .map((each) => [each.metadata.name, each.spec])
        .sort(),
    );
  };

  const openRow = async (page: string, name: string, kind: string) => {
    const { session, frame } = context();

    await clickSidebar(session, frame, `redis-${page}`, "redis");
    await waitFor("rows", async () =>
      (await countOf(session, frame, `[data-section="redis-${page}"] tbody tr`)) > 0
        ? true
        : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="redis-${page}"] tbody tr')].find((row) => row.querySelector("td:not(.Redis-table__check)")?.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:not(.Redis-table__check)").click()`,
      frame,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `${kind}: ${name}` &&
      (await countOf(session, frame, `${DRAWER} [data-section="redis-nodes"]`)) > 0
        ? true
        : undefined,
    );
  };

  return { toolbarIcon, specs, openRow };
};

export const redisWrites = (context: Context) => {
  const js = <T>(code: string) => {
    const { session, frame } = context();

    return session.evaluate<T>(code, frame);
  };
  const get = (path: string) => {
    const { session, frame } = context();

    return clusterObject(session, frame, path);
  };
  const pod = (name: string) => get(`${PODS}/${name}`);
  const podsOf = async (app: string) =>
    ((await get(`${PODS}?labelSelector=app%3D${app}`))?.items ?? []) as KubeObject[];
  // Puts a size back after a test that failed half-way; the test itself sets sizes through the UI.
  const resize = (path: string, clusterSize: number) => {
    const { session, frame } = context();

    return restore(session, frame, "PATCH", `${GROUP}/${path}`, { spec: { clusterSize } });
  };

  const openRow = async (page: string, name: string, kind: string) => {
    const { session, frame } = context();

    await clickSidebar(session, frame, `redis-${page}`, "redis");
    await waitFor("rows", async () =>
      (await js<number>(
        `document.querySelectorAll('[data-section="redis-${page}"] tbody tr').length`,
      )) > 0
        ? true
        : undefined,
    );
    await js(
      `[...document.querySelectorAll('[data-section="redis-${page}"] tbody tr')].find((row) => row.querySelector("td:not(.Redis-table__check)")?.textContent.startsWith(${JSON.stringify(name)}))?.querySelector("td:not(.Redis-table__check)").click()`,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `${kind}: ${name}` ? true : undefined,
    );
  };

  const toolbar = (icon: string) =>
    js(
      `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(icon)}).click()`,
    );

  return { js, get, pod, podsOf, resize, openRow, toolbar };
};
