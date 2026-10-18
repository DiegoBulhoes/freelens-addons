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
  leaveNothingBehind,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  CLUSTERS,
  type ClusterItem,
  cnpgHelpers,
  DRAWER,
  healthyCluster,
  type PodItem,
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

  const { openDetail, fromInstanceMenu } = cnpgHelpers(() => ({ session, frame }));
  const openDrawer = () => openDetail(cluster.metadata.name);

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

  it("restarts no instance when the wrong name is typed", async () => {
    const name = replica();
    const podsPath = `/api/v1/namespaces/${cluster.metadata.namespace}/pods?labelSelector=cnpg.io/cluster=${cluster.metadata.name}`;
    const stamp = async () =>
      (await clusterItems<{ metadata: { name: string; uid: string } }>(session, frame, podsPath))
        .map((pod) => `${pod.metadata.name}@${pod.metadata.uid}`)
        .sort();
    const before = await stamp();

    await openDrawer();
    await fromInstanceMenu(name, "Restart");
    expect(await dialogText(session, frame)).toMatch(/Deletes its pod/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickWhenShown(session, frame, ".ConfirmDialog button", "Restart");
    expect(await notificationSaying(session, frame, `Nothing was changed: "${name}"`)).toBeTruthy();
    expect(await stamp()).toEqual(before);
  }, 60_000);

  it("closes an instance's menu once an item is picked, and keeps the drawer open", async () => {
    await openDrawer();
    await fromInstanceMenu(replica(), "Restart");
    await dialogText(session, frame);

    expect(
      await waitFor(
        "the menu to close",
        async () =>
          (await session.evaluate<number>(
            `[...document.querySelectorAll('.MenuItem')].filter((each) => !each.closest('${DRAWER}')).length`,
            frame,
          )) === 0
            ? true
            : undefined,
        // The host's close animation is under a second; longer means it stayed open.
        5_000,
      ),
    ).toBe(true);
    expect(
      await countOf(session, frame, `${DRAWER} [data-section="cnpg-instances"]`),
    ).toBeGreaterThan(0);

    await cancelDialog(session, frame);
  }, 60_000);

  it("says the primary restarts in place, and refuses to destroy it", async () => {
    await openDrawer();

    const primary = cluster.status?.currentPrimary ?? "";

    await fromInstanceMenu(primary, "Restart");
    expect(await dialogText(session, frame)).toMatch(/restarts in place, without a switchover/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await cancelDialog(session, frame);

    await fromInstanceMenu(primary, "Destroy");
    expect(await notificationSaying(session, frame, "is the primary")).toContain(primary);
    expect(await countOf(session, frame, ".ConfirmDialog")).toBe(0);
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
    expect(await dialogText(session, frame)).toMatch(/Deletes its pod, its jobs and its volumes/);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickWhenShown(session, frame, ".ConfirmDialog button", "Destroy");
    expect(await notificationSaying(session, frame, `Nothing was changed: "${name}"`)).toBeTruthy();

    const after = (await clusterItems<{ metadata: { uid: string } }>(session, frame, pvcPath)).map(
      (pvc) => pvc.metadata.uid,
    );

    expect(after).toEqual(before);
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

  const { openCluster, opensDockTab } = cnpgHelpers(() => ({ session, frame }));
  const healthy = () => healthyCluster(clusters);

  it("opens psql on an instance in a terminal tab, and its log in a log tab", async () => {
    const name = healthy();

    await openCluster(name);

    const instance = await session.evaluate<string>(
      `document.querySelector('${DRAWER} [data-section="cnpg-instances"] .CNPG-row__name b')?.textContent ?? ""`,
      frame,
    );

    expect(instance.startsWith(`${name}-`)).toBe(true);
    expect(await opensDockTab("psql", `psql ${instance}`, "postgres=#")).toBe(1);

    // Closing the tab is a click outside the drawer, which closes it.
    await openCluster(name);
    expect(await opensDockTab("Log", `Pod ${instance}`)).toBe(1);
  }, 60_000);

  it("shows the primary first and marked, then each replica", async () => {
    const name = healthy();

    await openCluster(name);

    const roles = await session.evaluate<string[]>(
      `[...document.querySelectorAll('${DRAWER} [data-section="cnpg-instances"] .CNPG-row__state')].map((each) => each.textContent.trim())`,
      frame,
    );
    const primary = clusters.find((each) => each.metadata.name === name)?.status?.currentPrimary;
    const firstName = await session.evaluate<string>(
      `document.querySelector('${DRAWER} [data-section="cnpg-instances"] .CNPG-row__name b')?.textContent ?? ""`,
      frame,
    );

    expect(roles[0]).toBe("Primary");
    expect(roles.slice(1).every((role) => role === "Replica")).toBe(true);
    expect(firstName).toBe(primary);
    expect(
      await countOf(session, frame, `${DRAWER} [data-section="cnpg-instances"] .CNPG-row--info`),
      "only the primary is marked",
    ).toBe(1);
  }, 60_000);

  it("restarts no replica when the wrong name is typed", async () => {
    const name = healthy();
    const namespace = clusters.find((each) => each.metadata.name === name)?.metadata.namespace;
    const podsPath = `/api/v1/namespaces/${namespace}/pods?labelSelector=cnpg.io/cluster=${name}`;
    const before = await clusterItems<PodItem>(session, frame, podsPath);

    await openCluster(name);
    await clickWhenShown(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-instances"] button`,
      "Restart replicas",
    );

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Restart every replica of/);
    expect(dialog).toMatch(/one at a time/);
    expect(await countOf(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]')).toBe(
      1,
    );
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickWhenShown(session, frame, ".ConfirmDialog button", "Restart");

    expect(await notificationSaying(session, frame, "Nothing was changed")).toContain(name);

    const after = await clusterItems<PodItem>(session, frame, podsPath);
    const stamp = (items: PodItem[]) =>
      items.map((pod) => `${pod.metadata.name}@${pod.metadata.creationTimestamp}`).sort();

    expect(stamp(after)).toEqual(stamp(before));
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
