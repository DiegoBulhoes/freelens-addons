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
import { drawerReads, INSTANCE } from "../support/prometheus";

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

  const { texts, where, factOf, bannerSaying } = drawerReads(() => ({ session, frame }));

  describe("an instance's", () => {
    it("shows no-image not available, with the condition that says so", async () => {
      await openRow(
        session,
        frame,
        LISTS.instances,
        "prom-broken/no-image",
        "Prometheus: no-image",
        INSTANCE,
        "Prometheus",
      );

      expect(await bannerSaying("Not available")).toBe("Not available");
      expect(
        await texts(`${DRAWER} [data-section="prometheus-instance-conditions"] .Prometheus-status`),
      ).toContain("Available: False");
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="prometheus-instance-commands"] button`,
        ),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("shows the seed Prometheus available, with its shards", async () => {
      await openRow(
        session,
        frame,
        LISTS.instances,
        "monitoring/seed",
        "Prometheus: seed",
        INSTANCE,
        "Prometheus",
      );

      expect(await drawerTerms(session, frame)).toEqual(
        expect.arrayContaining([
          "Kind",
          "Ready",
          "Shards",
          "Available",
          "Reconciled",
          "Alertmanagers",
          "Sends alerts to",
        ]),
      );
      expect(
        await texts(`${DRAWER} .Prometheus-facts .Prometheus-link`).then((links) =>
          links.filter((each) => each.startsWith("monitoring/alertmanager")),
        ),
      ).toEqual(["monitoring/alertmanager-operated:web", "monitoring/alertmanager:web"]);
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="prometheus-instance-shards"] .Prometheus-row`,
        ),
      ).toBeGreaterThan(0);
      expect(await countOf(session, frame, `${DRAWER} .Prometheus-banner`)).toBe(0);
    }, 120_000);

    // The seed's second entry names a Service that does not exist, so only the first finds one.
    it("sends the seed Prometheus's alerts to the one Alertmanager it discovered, and links its Services", async () => {
      await openRow(
        session,
        frame,
        LISTS.instances,
        "monitoring/seed",
        "Prometheus: seed",
        INSTANCE,
        "Prometheus",
      );

      const sendsTo = await waitFor(
        "where its alerts go",
        async () => {
          const text = await factOf("Sends alerts to");

          return text && text !== "Not read yet" ? text : undefined;
        },
        90_000,
      );

      expect(sendsTo).toMatch(/^https?:\/\/\S+$/);
      // Available, not the No Alertmanager warning.
      expect(await countOf(session, frame, `${DRAWER} .Prometheus-banner`)).toBe(0);

      await clickWhenShown(
        session,
        frame,
        `${DRAWER} .Prometheus-facts .Prometheus-link`,
        "monitoring/alertmanager-operated:web",
      );
      expect(
        await waitFor("the host's Services list", async () => {
          const at = await where();

          return at.startsWith("/services") ? at : undefined;
        }),
      ).toContain("search=alertmanager-operated");
    }, 120_000);

    it("says the paused agent is left as it is", async () => {
      await openRow(
        session,
        frame,
        LISTS.instances,
        "monitoring/agent",
        "PrometheusAgent: agent",
        INSTANCE,
        "PrometheusAgent",
      );

      expect(await textOf(session, frame, `${DRAWER} ${INSTANCE} > .Prometheus-muted`)).toBe(
        "The operator leaves it as it is",
      );
    }, 120_000);
  });

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
