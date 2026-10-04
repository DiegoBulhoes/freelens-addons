import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../build/e2e/design";
import {
  clickByText,
  clickSidebar,
  clusterItems,
  hoverForTooltip,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../build/e2e/freelens";

// Read-only: every write is cancelled at its confirmation, or confirmed with the wrong name.

const CLUSTERS = "/apis/postgresql.cnpg.io/v1/clusters";
const DRAWER = ".CNPGObjectDrawer";
const ICON = (name: string) =>
  `[...document.querySelectorAll(${JSON.stringify(`${DRAWER} .drawer-title i.Icon`)})].find((each) => each.textContent.trim() === ${JSON.stringify(name)})`;

interface ClusterItem {
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  status?: { readyInstances?: number; currentPrimary?: string };
  spec: { instances: number; plugins?: unknown[] };
}

describe("the CloudNativePG controls", () => {
  let session: Session;
  let frame: number;
  let clusters: ClusterItem[];

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());
    clusters = await clusterItems<ClusterItem>(session, frame, CLUSTERS);
  }, 180_000);

  afterAll(() => session?.close());

  const countOf = (selector: string) =>
    session.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
      frame,
    );

  const dialogText = () =>
    waitFor("the confirmation", async () => {
      const text = await session.evaluate<string>(
        "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
        frame,
      );

      return text || undefined;
    });

  const cancelDialog = async () => {
    await clickByText(session, frame, ".ConfirmDialog button", "Cancel");
    await waitFor("the dialog to close", async () =>
      (await countOf(".ConfirmDialog")) === 0 ? true : undefined,
    );
  };

  /** Opens the drawer of the cluster whose row starts with `name`. */
  const openCluster = async (name: string) => {
    await clickSidebar(session, frame, "cnpg-clusters", "cnpg");
    await waitFor("the clusters table", async () =>
      (await countOf('[data-section="cnpg-clusters"] tbody tr')) > 0 ? true : undefined,
    );
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="cnpg-clusters"] tbody tr td:not(.CNPG-table__check)')]
        .find((cell) => cell.textContent.startsWith(${JSON.stringify(name)}))?.click()`,
      frame,
    );

    return waitFor(`${name}'s drawer`, async () =>
      (await countOf(`${DRAWER} [data-section="cnpg-cluster"]`)) > 0
        ? session.evaluate<string>(
            `document.querySelector(${JSON.stringify(DRAWER)}).textContent`,
            frame,
          )
        : undefined,
    );
  };

  const closeDrawer = async () => {
    await session.evaluate(`${ICON("close")}?.click()`, frame);
    await waitFor("the drawer to close", async () =>
      (await countOf(`${DRAWER} [data-section="cnpg-cluster"]`)) === 0 ? true : undefined,
    );
  };

  const healthy = () => {
    const found = clusters.find(
      (each) =>
        (each.status?.readyInstances ?? 0) > 1 &&
        each.status?.readyInstances === each.spec.instances &&
        each.metadata.annotations?.["cnpg.io/hibernation"] !== "on" &&
        (each.spec.plugins?.length ?? 0) > 0,
    );

    if (!found)
      throw new Error("the dev cluster has no healthy, replicated, backed-up Postgres cluster");

    return found.metadata.name;
  };

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
      expect(await countOf(`${DRAWER} [data-section="${section}"]`), section).toBe(1);
    }
    expect(await designViolations(session, frame, "CNPG")).toEqual([]);
  }, 90_000);

  it("puts every action in the title bar, each with a tooltip", async () => {
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
      await session.evaluate(`${ICON(icon)}.click()`, frame);

      expect(await dialogText()).toMatch(says);
      expect(await countOf('.ConfirmDialog input[aria-label="Confirmation"]')).toBe(typed ? 1 : 0);
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await cancelDialog();
    },
    60_000,
  );

  it("offers only the cluster's healthy replicas to promote, one picked", async () => {
    await session.evaluate(`${ICON("swap_horiz")}.click()`, frame);
    await dialogText();

    const offered = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.ConfirmDialog .CNPG-filter')].map((each) => each.textContent.trim())`,
      frame,
    );
    const primary = clusters.find((each) => each.metadata.name === healthy())?.status
      ?.currentPrimary;

    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(primary);
    expect(await countOf('.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(1);

    await cancelDialog();
  }, 60_000);

  it("restarts nothing when the wrong name is typed", async () => {
    const name = healthy();

    await session.evaluate(`${ICON("restart_alt")}.click()`, frame);
    await dialogText();
    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", "Restart");

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

  // Freelens keeps dock tabs across restarts and suffixes a repeated title " (2)": count, never assume.
  const dockTabs = (title: string) =>
    session.evaluate<number>(
      `[...document.querySelectorAll('.Dock [class*="DockTab"] [class*="title"]')].filter((each) => each.textContent.trim().startsWith(${JSON.stringify(title)})).length`,
      frame,
    );

  // A bare click() leaves the tab open, and an open psql tab keeps its session alive in the pod.
  const closeLastDockTab = (title: string) =>
    session.evaluate(
      `(() => {
        const tab = [...document.querySelectorAll('.Dock [class*="DockTab"]')].filter((each) => each.querySelector('[class*="title"]')?.textContent.trim().startsWith(${JSON.stringify(title)})).at(-1);
        const close = tab?.querySelector('[class*="close"]');
        const target = close?.querySelector("i") ?? close;
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      })()`,
      frame,
    );

  const opensDockTab = async (button: string, title: string) => {
    const before = await dockTabs(title);

    await clickByText(session, frame, `${DRAWER} [data-section="cnpg-instances"] button`, button);

    const after = await waitFor(`a new "${title}" tab`, async () => {
      const now = await dockTabs(title);

      return now > before ? now : undefined;
    });

    await closeLastDockTab(title);
    await waitFor(`the "${title}" tab to close`, async () =>
      (await dockTabs(title)) === before ? true : undefined,
    );

    return after - before;
  };

  it("opens psql on an instance in a terminal tab, and its log in a log tab", async () => {
    const name = healthy();

    await openCluster(name);

    const instance = await session.evaluate<string>(
      `document.querySelector('${DRAWER} [data-section="cnpg-instances"] .CNPG-row__name b')?.textContent ?? ""`,
      frame,
    );

    expect(instance.startsWith(`${name}-`)).toBe(true);
    expect(await opensDockTab("psql", `psql ${instance}`)).toBe(1);

    // Closing the tab is a click outside the drawer, which closes it.
    await openCluster(name);
    expect(await opensDockTab("Log", `Pod ${instance}`)).toBe(1);
  }, 60_000);

  interface PodItem {
    metadata: { name: string; creationTimestamp: string };
  }

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
      await countOf(`${DRAWER} [data-section="cnpg-instances"] .CNPG-row--info`),
      "only the primary is marked",
    ).toBe(1);
  }, 60_000);

  it("restarts no replica when the wrong name is typed", async () => {
    const name = healthy();
    const namespace = clusters.find((each) => each.metadata.name === name)?.metadata.namespace;
    const podsPath = `/api/v1/namespaces/${namespace}/pods?labelSelector=cnpg.io/cluster=${name}`;
    const before = await clusterItems<PodItem>(session, frame, podsPath);

    await clickByText(
      session,
      frame,
      `${DRAWER} [data-section="cnpg-instances"] button`,
      "Restart replicas",
    );

    const dialog = await dialogText();

    expect(dialog).toMatch(/Restart every replica of/);
    expect(dialog).toMatch(/one at a time/);
    expect(await countOf('.ConfirmDialog input[aria-label="Confirmation"]')).toBe(1);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await clickByText(session, frame, ".ConfirmDialog button", "Restart");

    expect(await notificationSaying(session, frame, "Nothing was changed")).toContain(name);

    const after = await clusterItems<PodItem>(session, frame, podsPath);
    const stamp = (items: PodItem[]) =>
      items.map((pod) => `${pod.metadata.name}@${pod.metadata.creationTimestamp}`).sort();

    expect(stamp(after)).toEqual(stamp(before));
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
    expect(await countOf(".ConfirmDialog")).toBe(0);

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
    expect(await dialogText()).toMatch(/Wake /);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);
    await cancelDialog();
    await closeDrawer();
  }, 60_000);

  it("opens the clusters list narrowed to a row of the overview", async () => {
    await clickSidebar(session, frame, "cnpg-overview", "cnpg");
    await waitFor("attention rows", async () =>
      (await countOf(".CNPG-row")) > 0 ? true : undefined,
    );

    const name = await session.evaluate<string>(
      `(() => {
        const row = [...document.querySelectorAll('.CNPG-row')].find((each) => each.querySelector('.CNPG-row__meta')?.textContent.startsWith("Cluster"));
        row?.click();
        return row?.querySelector('.CNPG-row__name b')?.textContent ?? "";
      })()`,
      frame,
    );

    expect(name).not.toBe("");

    const search = await waitFor("the narrowed list", async () => {
      const value = await session.evaluate<string>(
        `document.querySelector('[data-section="cnpg-clusters"]') ? document.querySelector('.CNPG-search').value : ""`,
        frame,
      );

      return value || undefined;
    });

    expect(search).toBe(name);
    expect(await countOf('[data-section="cnpg-clusters"] tbody tr')).toBe(1);
  }, 60_000);

  const fromRowMenu = async (section: string, row: string, item: string) => {
    await session.evaluate(
      `[...document.querySelectorAll('[data-section="${section}"] tbody tr')].find((tr) => tr.textContent.startsWith(${JSON.stringify(row)}))?.querySelector('.CNPG-table__actions i.Icon')?.click()`,
      frame,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await clickByText(session, frame, ".MenuItem", item);
  };

  it.each([
    ["cnpg-schedules", "orders-hourly", "Suspend", /Suspend schedule orders-hourly\?/],
    ["cnpg-schedules", "orders-weekly", "Start", /Start schedule orders-weekly\?/],
    [
      "cnpg-schedules",
      "orders-hourly",
      "Back up now",
      /Back up orders-db now, as orders-hourly would\?/,
    ],
    ["cnpg-poolers", "orders-rw", "Pause", /Pause pooler orders-rw\?/],
  ] as const)(
    "asks before %s %s: %s, in the theme",
    async (page, row, item, says) => {
      await clickSidebar(session, frame, page, "cnpg");
      await waitFor(`${page}'s rows`, async () =>
        (await countOf(`[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
      );
      await fromRowMenu(page, row, item);

      expect(await dialogText()).toMatch(says);
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await cancelDialog();
    },
    60_000,
  );

  it("backs up a cluster picked from the Backups page, offering only those that can be", async () => {
    await clickSidebar(session, frame, "cnpg-backups", "cnpg");
    await waitFor("the backups", async () =>
      (await countOf('[data-section="cnpg-backups"] tbody tr')) > 0 ? true : undefined,
    );
    await clickByText(session, frame, ".CNPG-page__actions button", "Back up");

    expect(await dialogText()).toMatch(/Back up which cluster now\?/);

    const offered = await session.evaluate<string[]>(
      `[...document.querySelectorAll('.ConfirmDialog .CNPG-filter')].map((each) => each.textContent.trim())`,
      frame,
    );
    const asleep = clusters.find(
      (each) => each.metadata.annotations?.["cnpg.io/hibernation"] === "on",
    );

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.some((each) => each.endsWith(`/${asleep?.metadata.name}`))).toBe(false);
    // One pressed choice per group: the cluster, and where to take it from.
    expect(await countOf('.ConfirmDialog .CNPG-filter[aria-pressed="true"]')).toBe(2);
    expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

    await cancelDialog();
  }, 60_000);

  it.each([
    ["cnpg-backups", "orders-hourly-", "/apis/postgresql.cnpg.io/v1/backups"],
    ["cnpg-schedules", "orders-hourly", "/apis/postgresql.cnpg.io/v1/scheduledbackups"],
    ["cnpg-poolers", "orders-rw", "/apis/postgresql.cnpg.io/v1/poolers"],
    ["cnpg-logical", "orders-pub", "/apis/postgresql.cnpg.io/v1/publications"],
  ] as const)(
    "deletes nothing on %s when the wrong name is typed",
    async (page, row, path) => {
      await clickSidebar(session, frame, page, "cnpg");
      await waitFor(`${page}'s rows`, async () =>
        (await countOf(`[data-section="${page}"] tbody tr`)) > 0 ? true : undefined,
      );

      const name = await session.evaluate<string>(
        `([...document.querySelectorAll('[data-section="${page}"] tbody tr td:not(.CNPG-table__check)')].find((cell) => cell.textContent.startsWith(${JSON.stringify(row)}))?.textContent ?? "").split(" · ")[0].trim()`,
        frame,
      );

      expect(name).not.toBe("");

      await fromRowMenu(page, name, "Delete");

      expect(await dialogText()).toMatch(new RegExp(`Type ${name} to confirm`));
      expect(await dialogColourViolations(session, frame, "CNPG")).toEqual([]);

      await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
      await clickByText(session, frame, ".ConfirmDialog button", "Delete");

      // An earlier "Nothing was changed" may still be on screen; wait for this one.
      expect(
        await notificationSaying(session, frame, `Nothing was changed: "${name}"`),
      ).toBeTruthy();

      const still = await clusterItems<{ metadata: { name: string } }>(session, frame, path);

      expect(still.map((each) => each.metadata.name)).toContain(name);
    },
    60_000,
  );
});
