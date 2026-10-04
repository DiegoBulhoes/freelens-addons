import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: writes are cancelled at their confirmation, or confirmed with the wrong name.

const CLUSTERS = "/apis/postgresql.cnpg.io/v1/clusters";
const DRAWER = ".CNPGObjectDrawer";

interface ClusterItem {
  metadata: { name: string; namespace: string };
  spec: { instances: number };
  status?: {
    currentPrimary?: string;
    readyInstances?: number;
    instanceNames?: string[];
    systemID?: string;
  };
}

describe("a replicated cluster, in detail", () => {
  let session: Session;
  let frame: number;
  let cluster: ClusterItem;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());

    const found = (await clusterItems<ClusterItem>(session, frame, CLUSTERS)).find(
      (each) => each.spec.instances > 2 && each.status?.readyInstances === each.spec.instances,
    );

    if (!found)
      throw new Error("the dev cluster has no Postgres cluster with three ready instances");
    cluster = found;
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const textOf = (selector: string) =>
    session.evaluate<string>(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`,
      frame,
    );

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await textOf(".ConfirmDialog");

      return text || undefined;
    });

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  const openDrawer = async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters", async () =>
      (await countOf('[data-section="cnpg-clusters"] tbody tr')) > 0 ? true : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith(${JSON.stringify(cluster.metadata.name)}))?.click()`,
      frame,
    );
    await waitFor("the drawer", async () =>
      (await countOf(`${DRAWER} [data-section="cnpg-instances"]`)) > 0 ? true : undefined,
    );
  };

  /** Opens an instance row's ⋮ menu and picks an item. */
  const fromInstanceMenu = async (instance: string, item: string) => {
    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].find((row) => row.querySelector('.CNPG-row__name b')?.textContent === ${JSON.stringify(instance)})?.querySelector('.CNPG-row__actions i.Icon')?.click()`,
      frame,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  const replica = () => {
    const name = cluster.status?.instanceNames?.find(
      (each) => each !== cluster.status?.currentPrimary,
    );

    if (!name) throw new Error(`${cluster.metadata.name} has no replica`);

    return name;
  };

  it("names each instance's node, and each replica's lag as the primary sees it", async () => {
    await openDrawer();

    const metas = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row__meta')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(metas.every((meta) => /\S+ · (Guaranteed|Burstable|BestEffort)/.test(meta))).toBe(true);

    const lags = await waitFor("each replica's lag", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].filter((row) => row.querySelector('.CNPG-row__state')?.textContent === "Replica").map((row) => row.querySelector('.CNPG-row__reason')?.textContent ?? "")`,
        frame,
      );

      return found.length > 0 && found.every((text) => /behind/.test(text)) ? found : undefined;
    });

    expect(lags.length).toBe(cluster.spec.instances - 1);
  }, 90_000);

  it("tops the facts with the system ID, WAL position, uptime and size, as kubectl cnpg status does", async () => {
    const fact = (term: string) =>
      session.evaluate<string>(
        `[...document.querySelectorAll('${DRAWER} .CNPG-facts dt')].find((each) => each.textContent === ${JSON.stringify(term)})?.nextElementSibling?.textContent ?? ""`,
        frame,
      );

    expect(await fact("System ID")).toBe(cluster.status?.systemID);

    const filled = await waitFor("the live facts", async () => {
      const facts = {
        wal: await fact("WAL position"),
        up: await fact("Postgres up"),
        size: await fact("Size"),
      };

      return Object.values(facts).every((value) => value && value !== "—") ? facts : undefined;
    });

    expect(filled.wal).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
    expect(filled.up).toMatch(/, since \d{4}-\d{2}-\d{2}T/);
    expect(filled.size).toMatch(/^\d+(\.\d)? (kB|MB|GB) · app /);
  }, 60_000);

  it("shows slots, budgets, roles, maintenance and the merged log, built from the standard", async () => {
    for (const section of [
      "cnpg-replication",
      "cnpg-budgets",
      "cnpg-roles",
      "cnpg-maintenance",
      "cnpg-log",
    ]) {
      expect(await countOf(`${DRAWER} [data-section="${section}"]`), section).toBe(1);
    }

    await waitFor("the slots", async () =>
      (await countOf(`${DRAWER} [data-section="cnpg-replication"] dt`)) > 0 ? true : undefined,
    );
    expect(await textOf(`${DRAWER} [data-section="cnpg-budgets"]`)).toMatch(/\d+ of \d+ healthy/);
    expect(await designViolations(session, frame, "CNPG")).toEqual([]);
  }, 60_000);

  it("narrows the merged log by level, every instance's lines in one list", async () => {
    await clickByText(session, frame, `${DRAWER} [data-section="cnpg-log"] .CNPG-filter`, "All");

    const pods = await waitFor("lines from more than one instance", async () => {
      const found = await session.evaluate<string[]>(
        `[...new Set([...document.querySelectorAll('${DRAWER} [data-section="cnpg-log"] .CNPG-row__name b')].map((each) => each.textContent))]`,
        frame,
      );

      return found.length > 1 ? found : undefined;
    });

    expect(pods.every((pod) => pod.startsWith(`${cluster.metadata.name}-`))).toBe(true);

    await clickByText(session, frame, `${DRAWER} [data-section="cnpg-log"] .CNPG-filter`, "Errors");
    expect(
      await waitFor("only errors", async () => {
        const rows = await countOf(`${DRAWER} [data-section="cnpg-log"] .CNPG-row`);
        const errors = await countOf(`${DRAWER} [data-section="cnpg-log"] .CNPG-row--critical`);

        return rows === errors ? true : undefined;
      }),
    ).toBe(true);
  }, 60_000);

  it("restarts no instance when the wrong name is typed", async () => {
    const name = replica();
    const podsPath = `/api/v1/namespaces/${cluster.metadata.namespace}/pods?labelSelector=cnpg.io/cluster=${cluster.metadata.name}`;
    const stamp = async () =>
      (await clusterItems<{ metadata: { name: string; uid: string } }>(session, frame, podsPath))
        .map((pod) => `${pod.metadata.name}@${pod.metadata.uid}`)
        .sort();
    const before = await stamp();

    await fromInstanceMenu(name, "Restart");
    expect(await dialogText()).toMatch(/Deletes its pod/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", "Restart");
    expect(await notificationSaying(session, frame, `Nothing was changed: "${name}"`)).toBeTruthy();
    expect(await stamp()).toEqual(before);
  }, 60_000);

  it("says the primary restarts in place, and refuses to destroy it", async () => {
    await openDrawer();

    const primary = cluster.status?.currentPrimary ?? "";

    await fromInstanceMenu(primary, "Restart");
    expect(await dialogText()).toMatch(/restarts in place, without a switchover/);
    await cancelDialog();

    await fromInstanceMenu(primary, "Destroy");
    expect(await notificationSaying(session, frame, "is the primary")).toContain(primary);
    expect(await countOf(".ConfirmDialog")).toBe(0);
  }, 60_000);

  it("destroys no replica when the wrong name is typed, volumes included", async () => {
    await openDrawer();

    const name = replica();
    const pvcPath = `/api/v1/namespaces/${cluster.metadata.namespace}/persistentvolumeclaims?labelSelector=cnpg.io/instanceName=${name}`;
    const before = (await clusterItems<{ metadata: { uid: string } }>(session, frame, pvcPath)).map(
      (pvc) => pvc.metadata.uid,
    );

    expect(before.length).toBeGreaterThan(0);

    await fromInstanceMenu(name, "Destroy");
    expect(await dialogText()).toMatch(/Deletes its pod, its jobs and its volumes/);
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", "Destroy");
    expect(await notificationSaying(session, frame, `Nothing was changed: "${name}"`)).toBeTruthy();

    const after = (await clusterItems<{ metadata: { uid: string } }>(session, frame, pvcPath)).map(
      (pvc) => pvc.metadata.uid,
    );

    expect(after).toEqual(before);
  }, 60_000);

  it("asks before opening a maintenance window, offering what to do with a drained node's volume", async () => {
    await openDrawer();
    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "Start window",
    );

    expect(await dialogText()).toMatch(/Start the node maintenance window/);
    expect(await countOf('.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(1);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog();
  }, 60_000);

  it("lets a backup be taken from the primary or a standby", async () => {
    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .drawer-title i.Icon')].find((each) => each.textContent.trim() === "backup")?.click()`,
      frame,
    );

    expect(await dialogText()).toMatch(/Take it from/);

    const targets = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.ConfirmDialog .CNPG-filter')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(targets).toEqual(
      expect.arrayContaining(["Cluster default", "Prefer a standby", "Primary"]),
    );
    // Offline, checkpoint and archive settings belong to volume snapshots only.
    expect(await textOf(".ConfirmDialog")).not.toMatch(/Snapshot settings/);
    await cancelDialog();
  }, 60_000);

  it("shows each cluster's worst replica lag in the list", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");

    const lag = await waitFor("the lag column filled", async () => {
      const text = await session.evaluate<string>(
        `(() => {
          const headers = [...document.querySelectorAll('[data-section="cnpg-clusters"] th')].map((each) => each.textContent.trim());
          const row = [...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr')].find((each) => each.textContent.startsWith(${JSON.stringify(cluster.metadata.name)}));
          return row?.children[headers.indexOf("Lag")]?.textContent ?? "";
        })()`,
        frame,
      );

      return /\d+(\.\d)? (B|kB|MB|GB)/.test(text) ? text : undefined;
    });

    expect(lag).toMatch(/B$/);
  }, 60_000);
});
