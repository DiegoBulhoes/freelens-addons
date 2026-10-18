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
import { DRAWER, LISTS, openRow } from "../support/lists";
import { drawerReads, RULE } from "../support/prometheus";

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

  describe("a rule's", () => {
    it("shows always-firing's alert firing, and its groups", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/always-firing",
        "PrometheusRule: always-firing",
        RULE,
      );

      const alerts = await waitFor(
        "the firing alert",
        async () => {
          const found = await texts(
            `${DRAWER} [data-section="prometheus-rule-alerts"] .Prometheus-row__name b`,
          );

          return found.length > 0 ? found : undefined;
        },
        90_000,
      );

      expect(alerts).toContain("SeedAlwaysFiring");
      expect(
        await texts(`${DRAWER} [data-section="prometheus-rule-alerts"] .Prometheus-row__state`),
      ).toContain("Firing");
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="prometheus-rule-groups"] .Prometheus-row`,
        ),
      ).toBeGreaterThan(0);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("says why broken-rule was refused, and gives the command for its Events", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/broken-rule",
        "PrometheusRule: broken-rule",
        RULE,
      );

      expect(await bannerSaying("Rejected")).toBe("Rejected");

      const commands = await texts(`${DRAWER} [data-section="prometheus-rule-commands"] code`);

      expect(commands.some((each) => each.includes("reason=InvalidConfiguration"))).toBe(true);
    }, 120_000);

    it("shows failing-rule's evaluation error", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/failing-rule",
        "PrometheusRule: failing-rule",
        RULE,
      );

      expect(await bannerSaying("Evaluation failing")).toBe("Evaluation failing");

      const errors = await waitFor(
        "the evaluation error",
        async () => {
          const found = await texts(
            `${DRAWER} [data-section="prometheus-rule-failing"] .Prometheus-row__reason`,
          );

          return found.length > 0 ? found : undefined;
        },
        90_000,
      );

      expect(errors[0]).toMatch(/many-to-many matching not allowed/);
      expect(await designViolations(session, frame, "Prometheus")).toEqual([]);
    }, 120_000);

    it("gives unselected-rule the labels to commit", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/unselected-rule",
        "PrometheusRule: unselected-rule",
        RULE,
      );

      expect(await bannerSaying("Not selected")).toBe("Not selected");
      expect(
        await countOf(
          session,
          frame,
          `${DRAWER} [data-section="prometheus-rule-fix"] .Prometheus-yaml`,
        ),
      ).toBeGreaterThan(0);
    }, 120_000);
    it("shows pending-rule's alert pending, not firing", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/pending-rule",
        "PrometheusRule: pending-rule",
        RULE,
      );

      const alerts = await waitFor(
        "the pending alert",
        async () => {
          const found = await texts(
            `${DRAWER} [data-section="prometheus-rule-alerts"] .Prometheus-row__name b`,
          );

          return found.length > 0 ? found : undefined;
        },
        90_000,
      );

      expect(alerts).toEqual(["SeedPending"]);
      expect(
        await texts(`${DRAWER} [data-section="prometheus-rule-alerts"] .Prometheus-row__state`),
      ).toEqual(["Pending"]);
      expect(await factOf("Firing")).toBe("None");
    }, 120_000);

    it("says recording has no alert, and links the Prometheus that loads it to the Instances list", async () => {
      await openRow(
        session,
        frame,
        LISTS.rules,
        "prom-apps/recording",
        "PrometheusRule: recording",
        RULE,
      );

      expect(
        await waitFor(
          "the alerts note",
          async () => {
            const note = await textOf(
              session,
              frame,
              `${DRAWER} [data-section="prometheus-rule-alerts"] .Prometheus-section__note`,
            );

            return note === "None firing or pending." ? note : undefined;
          },
          90_000,
        ),
      ).toBe("None firing or pending.");
      expect(await factOf("Loaded by")).toBe("Prometheus monitoring/seed");

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
      expect(await countOf(session, frame, `${DRAWER} ${RULE}`)).toBe(0);
    }, 120_000);
  });

  it("opens all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
