import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  countOf,
  type ErrorLog,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, drawerTerms, LISTS, openRow } from "../support/lists";
import { drawerReads, LIVE_BOX, MONITOR } from "../support/prometheus";

// Read-only: the extension writes nothing, so nothing here can change the cluster.

describe("a Prometheus drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { texts, toolbarIcon, where, factOf, mutedReason, bannerSaying } = drawerReads(() => ({
    session,
    frame,
  }));

  describe("a monitor's", () => {
    it("shows prom-self healthy, with no banner, no fix and nothing in the title bar", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/prom-self",
        "ServiceMonitor: prom-self",
        MONITOR,
      );

      const reason = await waitFor(
        "prom-self's targets up",
        async () => {
          const text = await textOf(session, frame, `${DRAWER} ${MONITOR} > .Prometheus-muted`);

          return /^\d+ targets? up$/.test(text) ? text : undefined;
        },
        90_000,
      );

      expect(reason).toMatch(/up$/);
      expect(await countOf(session, frame, `${DRAWER} .Prometheus-banner`)).toBe(0);
      expect(
        await countOf(session, frame, `${DRAWER} [data-section="prometheus-monitor-fix"]`),
      ).toBe(0);
      expect(
        await session.evaluate<boolean>(`Boolean(${toolbarIcon("content_copy")})`, frame),
      ).toBe(false);
    }, 120_000);
    it("says otel-self is taken by a TargetAllocator alone, whose collector holds its health", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "prom-apps/otel-self",
        "ServiceMonitor: otel-self",
        MONITOR,
      );

      expect(
        await mutedReason(MONITOR, /has a job for it; its targets' health is in the collector$/),
      ).toMatch(/^TargetAllocator of otel-collectors\/scraper /);
      expect(await countOf(session, frame, `${DRAWER} .Prometheus-banner`)).toBe(0);
      expect(await texts(`${LIVE_BOX} .Prometheus-box__meta`)).toEqual(["has a job for it"]);
      expect(await texts(`${LIVE_BOX} .Prometheus-box__reason`)).toEqual([
        "It hands this monitor's targets to its collector, whose own metrics tell their health.",
      ]);
      // The collector behind a TargetAllocator has no list here.
      expect(await factOf("Selected by")).toBe("TargetAllocator of otel-collectors/scraper");
      expect(
        await texts(`${DRAWER} .Prometheus-facts .Prometheus-link`).then((links) =>
          // Its Service, scraper-collector-monitoring, is linked under Matched.
          links.filter((each) => each.endsWith("otel-collectors/scraper")),
        ),
      ).toEqual([]);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("says paused-only's one source, the paused agent, was not read", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/paused-only",
        "ServiceMonitor: paused-only",
        MONITOR,
      );

      expect(
        await waitFor("the live box", async () => {
          const meta = await texts(`${LIVE_BOX} .Prometheus-box__meta`);

          return meta.length > 0 ? meta : undefined;
        }),
      ).toEqual(["not read"]);
      expect(await texts(`${LIVE_BOX} .Prometheus-box__reason`)).toEqual([
        "PrometheusAgent monitoring/agent is paused",
      ]);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("shows static-self's static targets up, with no Kubernetes check", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "prom-apps/static-self",
        "ScrapeConfig: static-self",
        MONITOR,
      );

      expect(await mutedReason(MONITOR, /^\d+ targets? up$/)).toMatch(/up$/);

      const terms = await drawerTerms(session, frame);

      expect(terms).toContain("Static targets");
      expect(terms).not.toContain("Selector");
      expect(await factOf("Static targets")).not.toBe("None");
      expect(
        await countOf(session, frame, `${DRAWER} [data-section="prometheus-monitor-endpoints"]`),
      ).toBe(0);
      expect(await countOf(session, frame, `${DRAWER} .Prometheus-banner`)).toBe(0);
    }, 120_000);

    it("says the operator refused rejected, which Prometheus has not loaded, and gives the command for its Events", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/rejected",
        "ServiceMonitor: rejected",
        MONITOR,
      );

      expect(await bannerSaying("Rejected")).toBe("Rejected");
      expect(await textOf(session, frame, `${DRAWER} .Prometheus-banner__body`)).not.toBe("");
      expect(
        await waitFor(
          "the live read",
          async () => {
            const reasons = await texts(`${LIVE_BOX} .Prometheus-box__reason`);

            return reasons.length > 0 ? reasons : undefined;
          },
          90_000,
        ),
      ).toEqual(["It has not loaded this monitor; the operator's Events or its logs say why."]);
      expect(
        (await texts(`${DRAWER} [data-section="prometheus-monitor-commands"] code`)).some((each) =>
          each.includes("reason=InvalidConfiguration"),
        ),
      ).toBe(true);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("says no-endpoints' Service has the port and no endpoint, and links the Service", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "prom-apps/no-endpoints",
        "ServiceMonitor: no-endpoints",
        MONITOR,
      );

      expect(await bannerSaying("No endpoints")).toBe("No endpoints");
      expect(await textOf(session, frame, `${DRAWER} .Prometheus-banner__body`)).toBe(
        "prom-apps/idle has no endpoint on port web",
      );
      expect(await texts(`${DRAWER} [data-section="prometheus-monitor-endpoints"] dd`)).toContain(
        "No endpoint",
      );

      await clickWhenShown(
        session,
        frame,
        `${DRAWER} [data-section="prometheus-monitor-endpoints"] .Prometheus-link`,
        "prom-apps/idle",
      );
      expect(
        await waitFor("the host's Services list", async () => {
          const at = await where();

          return at.startsWith("/services") ? at : undefined;
        }),
      ).toContain("search=idle");
    }, 120_000);
  });

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
