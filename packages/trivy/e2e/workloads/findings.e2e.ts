import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickWhenShown,
  countOf,
  type ErrorLog,
  openWorkbench,
  pressChip,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { checkLinks, chipCount, expectEachToName } from "../support/trivy";
import {
  BODY,
  closeDrawer,
  column,
  openRow,
  openWorkloads,
  waitForPods,
} from "../support/workloads";

describe("the controls on the Trivy pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  // states.sh rolls the seed's web once, so its old ReplicaSet runs no pod and keeps only an SBOM.
  describe("the seed's web, scanned and rolled once", () => {
    const FINDINGS = `${BODY} [data-section="trivy-workload-findings"]`;

    const webRow = async (state: string) => {
      await openWorkloads(session, frame);

      const names = await column(session, frame, "Workload");
      const namespaces = await column(session, frame, "Namespace");
      const states = await column(session, frame, "Coverage");
      const index = names.findIndex(
        (name, at) => name.startsWith("web-") && namespaces[at] === "demo" && states[at] === state,
      );

      expect(index, `no web ReplicaSet is ${state}`).toBeGreaterThanOrEqual(0);

      return openRow(session, frame, index);
    };

    it("calls the old ReplicaSet scaled away, neither unjudged nor clean, with no commands", async () => {
      await webRow("Scaled away");
      await waitForPods(session, frame);

      expect(
        await countOf(session, frame, `${BODY} .Trivy-banner`),
        "a scaled-away drawer alarms",
      ).toBe(0);
      expect(await countOf(session, frame, `${BODY} > p.Trivy-muted`)).toBe(1);
      expect(
        await countOf(session, frame, `${BODY} [data-section="trivy-workload-commands"]`),
      ).toBe(0);
      expect(await countOf(session, frame, FINDINGS)).toBe(0);

      await closeDrawer(session, frame);
    }, 90_000);

    it("says the current one's base is past end of life, in its state and its container", async () => {
      await webRow("Scanned");

      expect(await textOf(session, frame, `${BODY} .Trivy-banner__body`)).toMatch(
        /base is past its end of life/,
      );
      expect(
        await textOf(session, frame, `${BODY} [data-section="trivy-workload-containers"]`),
      ).toContain("end of life: findings are incomplete");
      expect(
        await countOf(session, frame, `${BODY} [data-section="trivy-workload-commands"]`),
      ).toBe(0);

      await closeDrawer(session, frame);
    }, 90_000);

    it("lists its first findings, then all of them on Show all, each linked over https", async () => {
      await webRow("Scanned");
      await pressChip(session, frame, `${FINDINGS} .Trivy-filters button`, "All");

      const all = await chipCount(session, frame, `${FINDINGS} .Trivy-filters`, "All");
      const rows = `${FINDINGS} .Trivy-table tbody tr`;

      expect(all, "web has too few findings to be cut").toBeGreaterThan(100);
      expect(
        await waitFor("the first findings", async () =>
          (await countOf(session, frame, rows)) === 100 ? true : undefined,
        ),
      ).toBe(true);

      await clickWhenShown(session, frame, `${FINDINGS} button.Trivy-link`, `Show all ${all}`);

      expect(
        await waitFor("every finding", async () =>
          (await countOf(session, frame, rows)) === all ? true : undefined,
        ),
      ).toBe(true);

      const links = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${rows} a`)})].map((each) => each.href)`,
        frame,
      );

      expect(links.length, "no finding links its advisory").toBeGreaterThan(0);
      for (const link of links) expect(link).toMatch(/^https:\/\//);

      await closeDrawer(session, frame);
    }, 90_000);
  });

  // Not followed: it leaves the app.
  describe("the links to where a check is explained", () => {
    it("links the failed config checks of a workload", async () => {
      const rows = await openWorkloads(session, frame);

      const found = await waitFor("a workload with failed checks", async () => {
        for (let at = 0; at < rows; at += 1) {
          await openRow(session, frame, at);
          await waitForPods(session, frame);

          const here = await checkLinks(
            session,
            frame,
            `${BODY} [data-section="trivy-workload-config"] .Trivy-row`,
          );

          if (here.length > 0) return here;
        }

        return undefined;
      });

      expectEachToName(found);
      await closeDrawer(session, frame);
    }, 150_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
