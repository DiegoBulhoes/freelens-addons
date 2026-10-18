import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  DEV_NODE,
  type ErrorLog,
  hoverForTooltip,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  CLUSTERS_NOTICE,
  cellOf,
  chooseInFilter,
  DRAWER,
  drawerTerms,
  filterSays,
  LISTS,
  NODE_CHARTS,
  NODE_FILTER,
  NODES,
  NOTICE,
  openList,
  openRow,
  rowsOf,
  USAGE_GROUP,
  WINDOW,
  windowSays,
} from "../support/lists";
import { CORES, REFRESH, resetUsage, SHARE, usageReads } from "../support/prometheus";

// Figures are the dev cluster's, so only their shape is checked.

describe("the Usage pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    await resetUsage(session, frame);
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { refreshReady, untilCell } = usageReads(() => ({ session, frame }));

  describe("Nodes", () => {
    it("shows the dev node's CPU, memory and disk, with no notice, as its Prometheus holds one cluster", async () => {
      await openList(session, frame, LISTS.nodes);

      expect(await untilCell(NODES, DEV_NODE, "CPU", SHARE)).toMatch(CORES);
      expect(await untilCell(NODES, DEV_NODE, "Memory", SHARE)).toMatch(SHARE);
      expect(await untilCell(NODES, DEV_NODE, "Disk", SHARE)).toMatch(SHARE);
      expect(await cellOf(session, frame, NODES, DEV_NODE, "State")).not.toMatch(/^No data/);
      expect(await countOf(session, frame, NOTICE)).toBe(0);
      expect(await countOf(session, frame, CLUSTERS_NOTICE)).toBe(0);
    }, 180_000);

    it("draws the four node charts", async () => {
      await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);

      const titles = await waitFor("the charts", async () => {
        const found = await session.evaluate<string[]>(
          `[...document.querySelectorAll('${NODE_CHARTS} .Prometheus-chart .Prometheus-section__title')].map((each) => each.textContent.trim())`,
          frame,
        );

        return found.length === 4 ? found : undefined;
      });

      expect(titles).toEqual(["CPU used", "Memory used", "Filesystem used", "Network rx + tx"]);
      expect(
        await waitFor(
          "a chart's canvas",
          async () => (await countOf(session, frame, `${NODE_CHARTS} canvas`)) || undefined,
          60_000,
        ),
      ).toBeGreaterThan(0);
    }, 90_000);

    // The window outlives the page, so the test sets its own start and puts 1h back.
    it("keeps the chosen window on the Pods page", async () => {
      await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);
      await waitFor(
        "the window select",
        async () => (await countOf(session, frame, WINDOW)) || undefined,
      );

      try {
        for (const window of [
          "5 minutes",
          "15 minutes",
          "30 minutes",
          "1 hour",
          "6 hours",
          "24 hours",
          "7 days",
          "6 hours",
        ]) {
          await chooseInFilter(session, frame, WINDOW, window);
          expect(await windowSays(session, frame)).toBe(window);
        }

        await clickSidebar(session, frame, LISTS.pods.page, USAGE_GROUP);
        await waitFor(
          "the Pods window select",
          async () => (await countOf(session, frame, WINDOW)) || undefined,
        );
        expect(await windowSays(session, frame)).toBe("6 hours");
      } finally {
        await chooseInFilter(session, frame, WINDOW, "1 hour").catch(() => undefined);
      }
      expect(await windowSays(session, frame)).toBe("1 hour");
    }, 90_000);

    // The chosen nodes outlive the page, so the test puts every node back.
    it("narrows the table and the charts to the chosen nodes", async () => {
      await openList(session, frame, LISTS.nodes);
      await untilCell(NODES, DEV_NODE, "CPU", SHARE);

      try {
        await chooseInFilter(session, frame, NODE_FILTER, DEV_NODE, `Node: ${DEV_NODE}`);
        expect(await filterSays(session, frame, NODE_FILTER)).toBe(`Node: ${DEV_NODE}`);
        expect(await countOf(session, frame, rowsOf(NODES))).toBe(1);
        expect(await cellOf(session, frame, NODES, DEV_NODE, "Name")).toBe(DEV_NODE);
      } finally {
        await chooseInFilter(session, frame, NODE_FILTER, "All nodes").catch(() => undefined);
      }
      expect(await filterSays(session, frame, NODE_FILTER)).toBe("All nodes");
    }, 120_000);

    it("asks again on Refresh, and says what it does", async () => {
      await clickSidebar(session, frame, LISTS.nodes.page, USAGE_GROUP);
      await waitFor(
        "Refresh to be ready",
        async () => ((await refreshReady()) ? true : undefined),
        120_000,
      );
      await session.evaluate(
        `document.querySelector(${JSON.stringify(REFRESH)}).setAttribute("data-hovered", "")`,
        frame,
      );
      expect(await hoverForTooltip(session, frame, "[data-hovered]")).toMatch(/every minute/);
      await session.evaluate(
        `document.querySelector("[data-hovered]")?.removeAttribute("data-hovered")`,
        frame,
      );

      await clickWhenShown(session, frame, REFRESH, "Refresh");
      expect(
        await waitFor(
          "Refresh to come back",
          async () => ((await refreshReady()) ? true : undefined),
          120_000,
        ),
      ).toBe(true);
      expect(await untilCell(NODES, DEV_NODE, "CPU", SHARE)).toMatch(SHARE);
    }, 180_000);

    it("opens the dev node's drawer, with its figures, charts and the host's list", async () => {
      await openRow(
        session,
        frame,
        LISTS.nodes,
        DEV_NODE,
        `Node: ${DEV_NODE}`,
        '[data-section="prometheus-usage-node"]',
      );

      expect(await drawerTerms(session, frame)).toEqual(
        expect.arrayContaining([
          "CPU",
          "Memory",
          "Fullest disk",
          "Network",
          "Kubelet pressure",
          "Host list",
        ]),
      );
      expect(
        await countOf(session, frame, `${DRAWER} [data-section^="prometheus-usage-node-drawer-"]`),
      ).toBe(4);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);

      await clickWhenShown(session, frame, `${DRAWER} .Prometheus-link`, "in the Nodes list");

      const landed = await waitFor("the host's Nodes list", async () => {
        const at = await session.evaluate<string>("location.pathname + location.search", frame);

        return at.startsWith("/nodes") ? at : undefined;
      });

      expect(decodeURIComponent(landed)).toContain(`search=${DEV_NODE}`);
    }, 180_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
