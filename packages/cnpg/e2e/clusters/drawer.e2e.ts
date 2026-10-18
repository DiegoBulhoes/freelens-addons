import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clusterItems,
  countOf,
  type ErrorLog,
  leaveNothingBehind,
  openWorkbench,
  pressChip,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  CLUSTERS,
  type ClusterItem,
  cnpgHelpers,
  DRAWER,
  healthyCluster,
  ICON,
  replicatedCluster,
} from "../support/cnpg";

describe("a replicated cluster, in detail", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let cluster: ClusterItem;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    cluster = await replicatedCluster(session, frame);
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const { openDetail, textOf } = cnpgHelpers(() => ({ session, frame }));
  const openDrawer = () => openDetail(cluster.metadata.name);

  it("tops the facts with the system ID, WAL position, uptime and size, as kubectl cnpg status does", async () => {
    await openDrawer();

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
    await openDrawer();
    for (const section of [
      "cnpg-replication",
      "cnpg-budgets",
      "cnpg-roles",
      "cnpg-maintenance",
      "cnpg-log",
    ]) {
      expect(await countOf(session, frame, `${DRAWER} [data-section="${section}"]`), section).toBe(
        1,
      );
    }

    await waitFor("the slots", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-replication"] dt`)) > 0
        ? true
        : undefined,
    );
    expect(await textOf(`${DRAWER} [data-section="cnpg-budgets"]`)).toMatch(/\d+ of \d+ healthy/);
    expect(await designViolations(session, frame, "CNPG")).toEqual([]);
  }, 60_000);

  it("narrows the merged log by level, every instance's lines in one list", async () => {
    await openDrawer();
    await pressChip(session, frame, `${DRAWER} [data-section="cnpg-log"] .CNPG-filter`, "All");

    const pods = await waitFor("lines from more than one instance", async () => {
      const found = await session.evaluate<string[]>(
        `[...new Set([...document.querySelectorAll('${DRAWER} [data-section="cnpg-log"] .CNPG-row__name b')].map((each) => each.textContent))]`,
        frame,
      );

      return found.length > 1 ? found : undefined;
    });

    expect(pods.every((pod) => pod.startsWith(`${cluster.metadata.name}-`))).toBe(true);

    await pressChip(session, frame, `${DRAWER} [data-section="cnpg-log"] .CNPG-filter`, "Errors");
    expect(
      await waitFor("only errors", async () => {
        const rows = await countOf(session, frame, `${DRAWER} [data-section="cnpg-log"] .CNPG-row`);
        const errors = await countOf(
          session,
          frame,
          `${DRAWER} [data-section="cnpg-log"] .CNPG-row--critical`,
        );

        return rows === errors ? true : undefined;
      }),
    ).toBe(true);
  }, 60_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("a replica cluster, in detail", () => {
  const REPLICA = "orders-replica-db";
  let session: Session;
  let frame: number;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const { openCluster } = cnpgHelpers(() => ({ session, frame }));
  // The drawer's textContent runs the facts together, so read them as pairs.
  const facts = () =>
    session.evaluate<[string, string][]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-cluster"] dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent ?? ""])`,
      frame,
    );

  it("names its designated primary, the source it replays and its WAL position", async () => {
    await openCluster(REPLICA);

    const filled = await waitFor("the replica's facts", async () => {
      const found = new Map(await facts());
      const wal = found.get("WAL position");

      return wal && wal !== "—" ? found : undefined;
    });

    expect(filled.has("Designated primary")).toBe(true);
    expect(filled.has("Primary")).toBe(false);
    expect(filled.get("Replica of")).toMatch(/^orders-db/);
    expect(filled.get("WAL position")).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
  }, 60_000);

  it("calls the same instance the designated primary in its instances", async () => {
    await openCluster(REPLICA);

    const role = await waitFor("the instance rows", async () => {
      const found = await session.evaluate<string>(
        `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row')].find((row) => row.querySelector(".CNPG-row__name b")?.textContent === "${REPLICA}-1")?.querySelector(".CNPG-row__state")?.textContent ?? ""`,
        frame,
      );

      return found || undefined;
    });

    expect(role).toBe("Designated primary");
  }, 60_000);

  it("is found by search as the replica of its source", async () => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters table", async () =>
      (await countOf(session, frame, '[data-section="cnpg-clusters"] tbody tr')) > 1
        ? true
        : undefined,
    );
    await typeInto(session, frame, ".CNPG-search", "replica of orders-db");

    const names = await waitFor("only the replica", async () => {
      const shown = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr')].map((row) => row.querySelector("td:not(.CNPG-table__check)")?.textContent ?? "")`,
        frame,
      );

      return shown.length === 1 ? shown : undefined;
    });

    expect(names[0]?.startsWith(REPLICA)).toBe(true);
    await typeInto(session, frame, ".CNPG-search", "");
  }, 60_000);
});

describe("the CloudNativePG controls", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;
  let clusters: ClusterItem[];

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
    clusters = await clusterItems<ClusterItem>(session, frame, CLUSTERS);
  }, 180_000);

  afterAll(() => session?.close());
  // A failed test leaves no dialog, drawer or ticks to the next.
  afterEach(() => leaveNothingBehind(session, frame, "cnpg-overview", "cnpg"));

  const { openCluster, closeDrawer } = cnpgHelpers(() => ({ session, frame }));
  const healthy = () => healthyCluster(clusters);

  it("opens a cluster from its row, with instances, backups and commands", async () => {
    const name = healthy();
    const text = await openCluster(name);

    expect(text).toContain(`Cluster: ${name}`);
    for (const section of [
      "cnpg-instances",
      "cnpg-cluster-backups",
      "cnpg-certificates",
      "cnpg-warnings",
      "cnpg-commands",
    ]) {
      expect(await countOf(session, frame, `${DRAWER} [data-section="${section}"]`), section).toBe(
        1,
      );
    }
    expect(await designViolations(session, frame, "CNPG")).toEqual([]);
  }, 90_000);

  it("follows a backup link from the cluster drawer to that backup's own drawer", async () => {
    await openCluster(healthy());

    const backup = await session.evaluate<string>(
      `(() => {
        const link = document.querySelector('${DRAWER} [data-section="cnpg-cluster-backups"] .CNPG-row__name .CNPG-link');
        link?.click();
        return link?.textContent ?? "";
      })()`,
      frame,
    );

    expect(backup).not.toBe("");

    const title = await waitFor("the backup's drawer", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-backup"]`)) > 0
        ? session.evaluate<string>(
            `document.querySelector(${JSON.stringify(`${DRAWER} .drawer-title`)})?.textContent ?? ""`,
            frame,
          )
        : undefined,
    );

    expect(title).toContain(`Backup: ${backup}`);
    await session.evaluate(`${ICON("close")}?.click()`, frame);
    await waitFor("the drawer to close", async () =>
      (await countOf(session, frame, `${DRAWER} [data-section="cnpg-backup"]`)) === 0
        ? true
        : undefined,
    );
  }, 60_000);

  it("reads the cluster's warning events into its drawer", async () => {
    await openCluster(healthy());

    const section = await waitFor("the warnings read", async () => {
      const text = await session.evaluate<string>(
        `document.querySelector('${DRAWER} [data-section="cnpg-warnings"]')?.textContent ?? ""`,
        frame,
      );

      return text && !text.includes("Reading the warning events") ? text : undefined;
    });

    expect(section).not.toMatch(/Could not read the warning events/);
    await closeDrawer();
  }, 60_000);

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
