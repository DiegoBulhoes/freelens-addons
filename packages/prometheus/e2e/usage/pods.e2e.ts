import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickSidebar,
  clickWhenShown,
  countOf,
  DEV_NODE,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  activeChip,
  cellOf,
  chooseInFilter,
  DRAWER,
  drawerTerms,
  filterSays,
  LISTS,
  NOTICE,
  openList,
  openRow,
  POD_CHART,
  POD_FILTER,
  PODS,
  pressChip,
  rowsOf,
  USAGE_GROUP,
} from "../support/lists";
import { METRIC_CHIPS, resetUsage, usageReads } from "../support/prometheus";

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

  const { podStarting, untilCell } = usageReads(() => ({ session, frame }));

  describe("Pods", () => {
    it("shows the seed Prometheus's CPU and memory, and its volume's share", async () => {
      await openList(session, frame, LISTS.pods);

      const key = "monitoring/prometheus-seed-0";

      expect(await untilCell(PODS, key, "CPU", /^\d/)).toMatch(/^\d+(\.\d+)?m?( · |$)/);
      expect(await untilCell(PODS, key, "Memory", /^\d/)).toMatch(
        /^\d+(\.\d+)? (B|KiB|MiB|GiB)( · |$)/,
      );
      expect(await untilCell(PODS, key, "Volumes", /^\d+%$/)).toMatch(/^\d+%$/);
      expect(await countOf(session, frame, NOTICE)).toBe(0);
    }, 180_000);

    it("leaves a host-network pod's network out", async () => {
      await openList(session, frame, LISTS.pods);

      const name = await podStarting("monitoring", "node-exporter-");

      expect(await cellOf(session, frame, PODS, `monitoring/${name}`, "Net rx")).toBe(
        "host network",
      );
      expect(await cellOf(session, frame, PODS, `monitoring/${name}`, "Net tx")).toBe(
        "host network",
      );
    }, 90_000);

    it("charts the top pods by the measure its chips pick", async () => {
      await clickSidebar(session, frame, LISTS.pods.page, USAGE_GROUP);
      await waitFor(
        "the measure chips",
        async () => (await countOf(session, frame, METRIC_CHIPS)) || undefined,
      );

      expect(await activeChip(session, frame, METRIC_CHIPS)).toBe("CPU");

      for (const measure of ["Memory", "Net rx", "Net tx", "Disk I/O", "CPU"]) {
        await pressChip(session, frame, METRIC_CHIPS, measure);

        expect(await activeChip(session, frame, METRIC_CHIPS)).toBe(measure);
        expect(await textOf(session, frame, `${POD_CHART} .Prometheus-section__title`)).toMatch(
          new RegExp(`^Top \\d+ by ${measure.replace("/", "\\/")}$`),
        );
      }
    }, 90_000);

    it("charts and lists only the chosen pods, and the top ten again with none chosen", async () => {
      await openList(session, frame, LISTS.pods);

      const key = "monitoring/prometheus-seed-0";

      await untilCell(PODS, key, "CPU", /^\d/);

      try {
        await chooseInFilter(session, frame, POD_FILTER, key, `Pod: ${key}`);
        expect(await filterSays(session, frame, POD_FILTER)).toBe(`Pod: ${key}`);
        expect(await textOf(session, frame, `${POD_CHART} .Prometheus-section__title`)).toBe(
          "1 chosen by CPU",
        );
        expect(await countOf(session, frame, rowsOf(PODS))).toBe(1);
      } finally {
        await chooseInFilter(session, frame, POD_FILTER, "All pods").catch(() => undefined);
      }
      expect(await textOf(session, frame, `${POD_CHART} .Prometheus-section__title`)).toMatch(
        /^Top \d+ by CPU$/,
      );
      expect(await countOf(session, frame, rowsOf(PODS))).toBeGreaterThan(1);
    }, 120_000);

    it("opens a pod's drawer, with its request and limit beside its use and no network chart for host network", async () => {
      await openList(session, frame, LISTS.pods);

      const name = await podStarting("monitoring", "node-exporter-");

      await openRow(
        session,
        frame,
        LISTS.pods,
        `monitoring/${name}`,
        `Pod: ${name}`,
        '[data-section="prometheus-usage-pod"]',
      );

      expect(await drawerTerms(session, frame)).toEqual(
        expect.arrayContaining([
          "Namespace",
          "Node",
          "CPU",
          "Memory",
          "Network",
          "Disk I/O",
          "Host list",
        ]),
      );
      expect(
        await session.evaluate<string>(
          `[...document.querySelectorAll('${DRAWER} .Prometheus-facts dt')].find((each) => each.textContent.trim() === "Network")?.nextElementSibling?.textContent ?? ""`,
          frame,
        ),
      ).toMatch(/^Host network/);
      expect(
        await countOf(session, frame, `${DRAWER} [data-section="prometheus-usage-pod-cpu"]`),
      ).toBe(1);
      expect(
        await countOf(session, frame, `${DRAWER} [data-section="prometheus-usage-pod-network"]`),
      ).toBe(0);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);

      await clickWhenShown(session, frame, `${DRAWER} .Prometheus-link`, DEV_NODE);

      const landed = await waitFor("the host's Nodes list", async () => {
        const at = await session.evaluate<string>("location.pathname + location.search", frame);

        return at.startsWith("/nodes") ? at : undefined;
      });

      expect(decodeURIComponent(landed)).toContain(`search=${DEV_NODE}`);
    }, 180_000);
  });

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
