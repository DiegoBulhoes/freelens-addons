import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickWhenShown,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  hoverForTooltip,
  leaveNothingBehind,
  notificationSaying,
  openWorkbench,
  typeInto,
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

// Read-only: every write is cancelled at its confirmation, or confirmed with the wrong name.

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

  it("asks before opening a maintenance window, offering what to do with a drained node's volume", async () => {
    await openDrawer();
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-maintenance"] button`,
      "Start window",
    );

    expect(await dialogText(session, frame)).toMatch(/Start the node maintenance window/);
    expect(await countOf(session, frame, '.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(
      1,
    );
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog(session, frame);
  }, 60_000);

  it("lets a backup be taken from the primary or a standby", async () => {
    await openDrawer();
    await session.evaluate(
      `[...document.querySelectorAll('${DRAWER} .drawer-title i.Icon')].find((each) => each.textContent.trim() === "backup")?.click()`,
      frame,
    );

    expect(await dialogText(session, frame)).toMatch(/Take it from/);

    const targets = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.ConfirmDialog .CNPG-filter')].map((each) => each.textContent.trim())`,
      frame,
    );

    expect(targets).toEqual(
      expect.arrayContaining(["Cluster default", "Prefer a standby", "Primary"]),
    );
    // Offline, checkpoint and archive settings belong to volume snapshots only.
    expect(await textOf(".ConfirmDialog")).not.toMatch(/Snapshot settings/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await cancelDialog(session, frame);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
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

  it("puts every action in the title bar, each with a tooltip", async () => {
    await openCluster(healthy());

    for (const [icon, says] of [
      ["terminal", /Opens psql on the primary/],
      ["backup", /Starts a backup now/],
      ["sync", /Reloads the configuration/],
      ["swap_horiz", /Promotes a replica/],
      ["bedtime", /Stops the cluster/],
      ["restart_alt", /Recreates every instance/],
    ] as const) {
      expect(await session.evaluate<boolean>(`Boolean(${ICON(icon)})`, frame), icon).toBe(true);

      await session.evaluate(`${ICON(icon)}.setAttribute("data-hovered", "")`, frame);
      expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`)).toMatch(says);
      await session.evaluate(
        `(() => {
          const icon = document.querySelector(${JSON.stringify(`${DRAWER} [data-hovered]`)});
          for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) {
            icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
          }
          icon?.removeAttribute("data-hovered");
        })()`,
        frame,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }, 90_000);

  it.each([
    ["backup", /Back up .* now\?/, false],
    ["sync", /Reload the configuration/, false],
    ["swap_horiz", /Switch .* over to another primary/, true],
    ["bedtime", /Hibernate /, true],
    ["restart_alt", /Restart /, true],
  ] as const)(
    "asks before %s, in the theme, typing the name only for what recreates pods",
    async (icon, says, typed) => {
      await openCluster(healthy());
      await session.evaluate(`${ICON(icon)}.click()`, frame);

      expect(await dialogText(session, frame)).toMatch(says);
      expect(await countOf(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]')).toBe(
        typed ? 1 : 0,
      );
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await cancelDialog(session, frame);
    },
    60_000,
  );

  it("offers only the cluster's healthy replicas to promote, one picked", async () => {
    await openCluster(healthy());
    await session.evaluate(`${ICON("swap_horiz")}.click()`, frame);
    await dialogText(session, frame);

    const offered = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.ConfirmDialog .CNPG-filter')].map((each) => each.textContent.trim())`,
      frame,
    );
    const primary = clusters.find((each) => each.metadata.name === healthy())?.status
      ?.currentPrimary;

    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(primary);
    expect(await countOf(session, frame, '.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(
      1,
    );
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog(session, frame);
  }, 60_000);

  it("restarts nothing when the wrong name is typed", async () => {
    const name = healthy();

    await openCluster(name);
    await session.evaluate(`${ICON("restart_alt")}.click()`, frame);
    await dialogText(session, frame);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickWhenShown(session, frame, ".ConfirmDialog button", "Restart");

    expect(await notificationSaying(session, frame, "Nothing was changed")).toContain(name);

    const after = (await clusterItems<ClusterItem>(session, frame, CLUSTERS)).find(
      (each) => each.metadata.name === name,
    );
    const before = clusters.find((each) => each.metadata.name === name);

    expect(after?.metadata.annotations?.["kubectl.kubernetes.io/restartedAt"]).toBe(
      before?.metadata.annotations?.["kubectl.kubernetes.io/restartedAt"],
    );

    await closeDrawer();
  }, 60_000);

  it("refuses a backup of a cluster with no method, with the reason", async () => {
    const bare = clusters.find(
      (each) =>
        !each.spec.plugins?.length &&
        (each.status?.readyInstances ?? 0) > 0 &&
        each.metadata.annotations?.["cnpg.io/hibernation"] !== "on",
    );

    if (!bare) throw new Error("the dev cluster has no running Postgres cluster without backups");

    await openCluster(bare.metadata.name);
    await session.evaluate(`${ICON("backup")}.click()`, frame);

    expect(await notificationSaying(session, frame, "no backup method")).toContain(
      bare.metadata.name,
    );
    expect(await countOf(session, frame, ".ConfirmDialog")).toBe(0);

    await closeDrawer();
  }, 60_000);

  it("offers Wake instead of Hibernate on a hibernated cluster", async () => {
    const asleep = clusters.find(
      (each) => each.metadata.annotations?.["cnpg.io/hibernation"] === "on",
    );

    if (!asleep) throw new Error("the dev cluster has no hibernated Postgres cluster");

    const text = await openCluster(asleep.metadata.name);

    expect(text).toMatch(/None while hibernated/);

    await session.evaluate(`${ICON("terminal")}.click()`, frame);
    expect(await notificationSaying(session, frame, "Wake it first")).toContain(
      asleep.metadata.name,
    );
    expect(await session.evaluate<boolean>(`Boolean(${ICON("wb_sunny")})`, frame)).toBe(true);
    expect(await session.evaluate<boolean>(`Boolean(${ICON("bedtime")})`, frame)).toBe(false);

    await session.evaluate(`${ICON("wb_sunny")}.click()`, frame);
    expect(await dialogText(session, frame)).toMatch(/Wake /);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await cancelDialog(session, frame);
    await closeDrawer();
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
