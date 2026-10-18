import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations } from "../../../../build/e2e/design";
import {
  clickWhenShown,
  countOf,
  drawerTitle,
  type ErrorLog,
  hoverForTooltip,
  notificationSaying,
  openWorkbench,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, drawerTerms, LISTS, openRow } from "../support/lists";
import { drawerReads, MONITOR } from "../support/prometheus";

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

  const { texts, toolbarIcons, toolbarIcon, where, bannerSaying } = drawerReads(() => ({
    session,
    frame,
  }));

  describe("a monitor's", () => {
    it("shows down-path down, with the error Prometheus gives, the Kubernetes check and commands", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/down-path",
        "ServiceMonitor: down-path",
        MONITOR,
      );

      expect(await bannerSaying("Down")).toBe("Down");
      expect(await textOf(session, frame, `${DRAWER} .Prometheus-banner__body`)).toMatch(
        /^\d+ of \d+ targets? down/,
      );
      expect(await drawerTerms(session, frame)).toEqual(
        expect.arrayContaining(["Namespace", "State", "Kind", "Selected by", "Selector", "Live"]),
      );

      const live = await texts(
        `${DRAWER} [data-section="prometheus-monitor-live"] .Prometheus-row--critical .Prometheus-row__reason`,
      );

      expect(live.length).toBeGreaterThan(0);
      expect(live.some((each) => each.includes("404"))).toBe(true);
      expect(await texts(`${DRAWER} [data-section="prometheus-monitor-endpoints"] dd`)).toContain(
        "Has endpoints",
      );
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="prometheus-monitor-commands"] button`,
        ),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("gives orphan, which nothing selects, the labels to commit, and copies them from the title bar", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "prom-apps/orphan",
        "ServiceMonitor: orphan",
        MONITOR,
      );

      expect(await bannerSaying("Not selected")).toBe("Not selected");

      const fixes = await texts(
        `${DRAWER} [data-section="prometheus-monitor-fix"] .Prometheus-row__name`,
      );

      expect(fixes.length).toBeGreaterThan(0);
      expect(fixes.every((each) => each.startsWith("Labels to join"))).toBe(true);
      expect(
        (await texts(`${DRAWER} [data-section="prometheus-monitor-fix"] .Prometheus-yaml`)).every(
          (each) => each.includes("labels:"),
        ),
      ).toBe(true);

      expect(await session.evaluate<number>(`${toolbarIcons("content_copy")}.length`, frame)).toBe(
        fixes.length,
      );

      for (const [index, fix] of fixes.entries()) {
        await session.evaluate(
          `${toolbarIcons("content_copy")}[${index}].setAttribute("data-hovered", "")`,
          frame,
        );
        expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`)).toContain(
          `Copies the YAML for: ${fix}. Commit it to Git; changes nothing in the cluster`,
        );
        await session.evaluate(
          `(() => {
            const icon = document.querySelector('${DRAWER} [data-hovered]');
            for (const type of ["pointerleave", "pointerout", "mouseleave", "mouseout"]) icon?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
            icon?.removeAttribute("data-hovered");
          })()`,
          frame,
        );
        await waitFor("the tooltip to hide", async () =>
          (await countOf(session, frame, '[class*="Tooltip"][class*="visible"]')) === 0
            ? true
            : undefined,
        );
      }

      await session.evaluate(`${toolbarIcon("content_copy")}.click()`, frame);
      // The clipboard needs a permission this frame lacks, so check the notification.
      expect(await notificationSaying(session, frame, "Fix YAML copied")).toBeTruthy();
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("tells wrong-port the port names its Service has", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "prom-apps/wrong-port",
        "ServiceMonitor: wrong-port",
        MONITOR,
      );

      expect(await bannerSaying("Port missing")).toBe("Port missing");
      expect(await texts(`${DRAWER} [data-section="prometheus-monitor-endpoints"] dd`)).toContain(
        "Port not found",
      );
      expect(
        await texts(`${DRAWER} [data-section="prometheus-monitor-fix"] .Prometheus-row__name`),
      ).toEqual(["The port to scrape"]);
      expect(
        (await texts(`${DRAWER} [data-section="prometheus-monitor-fix"] .Prometheus-yaml`))[0],
      ).toMatch(/- port: web # was: metrics/);
    }, 120_000);

    it("links kubelet's Prometheus to the Instances list and its Service to the host's", async () => {
      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/kubelet",
        "ServiceMonitor: kubelet",
        MONITOR,
      );
      await clickWhenShown(
        session,
        frame,
        `${DRAWER} .Prometheus-link`,
        "Prometheus monitoring/seed",
      );
      expect(
        await waitFor("the Instances list", async () => {
          const at = await where();

          return at.includes("/instances") ? at : undefined;
        }),
      ).toContain("name=seed");
      expect(await countOf(session, frame, `${DRAWER} ${MONITOR}`)).toBe(0);
      expect(
        await waitFor("seed's drawer", async () =>
          (await drawerTitle(session, frame, DRAWER)) === "Prometheus: seed" ? true : undefined,
        ),
      ).toBe(true);

      await openRow(
        session,
        frame,
        LISTS.monitors,
        "monitoring/kubelet",
        "ServiceMonitor: kubelet",
        MONITOR,
      );
      await clickWhenShown(session, frame, `${DRAWER} .Prometheus-link`, "kube-system/");
      expect(
        await waitFor("the host's Services list", async () => {
          const at = await where();

          return at.startsWith("/services") ? at : undefined;
        }),
      ).toContain("search=");
    }, 120_000);
  });

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
