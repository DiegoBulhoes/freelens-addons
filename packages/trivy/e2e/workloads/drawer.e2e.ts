import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  notificationText,
  openWorkbench,
  pressChip,
  shownDrawer,
  textOf,
  waitFor,
} from "../../../../build/e2e/freelens";
import { activeChip, JUDGED_OR_INACTIVE } from "../support/trivy";
import {
  BODY,
  closeDrawer,
  column,
  DRAWER,
  drawerTitle,
  openRow,
  openScannedWorkload,
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

  describe("a row of the workload list", () => {
    it("opens that workload's drawer, and another row switches it without closing", async () => {
      await openWorkloads(session, frame);

      const names = await column(session, frame, "Workload");

      expect(names.length, "only one workload to switch to").toBeGreaterThan(1);

      const kinds = await column(session, frame, "Kind");

      await openRow(session, frame, 0);
      expect(await drawerTitle(session, frame)).toBe(`${kinds[0]}: ${names[0]}`);

      await openRow(session, frame, 1);
      expect(await drawerTitle(session, frame)).toBe(`${kinds[1]}: ${names[1]}`);
      expect(await countOf(session, frame, BODY)).toBe(1);

      await closeDrawer(session, frame);
    }, 90_000);

    it("holds more than the row: its state, its facts, its pods, containers and config", async () => {
      await openScannedWorkload(session, frame);

      expect(await countOf(session, frame, `${BODY} .Trivy-banner, ${BODY} > p.Trivy-muted`)).toBe(
        1,
      );

      const facts = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${BODY} > .Trivy-facts > dt`)})].map((each) => each.textContent.trim())`,
        frame,
      );
      const [kind, name = ""] = (await drawerTitle(session, frame)).split(": ");
      // A ReplicaSet named by the Deployment controller also names that Deployment.
      const owner =
        kind === "ReplicaSet" && /-[bcdfghjklmnpqrstvwxz2456789]{6,10}$/.test(name)
          ? ["Deployment"]
          : [];

      expect(facts).toEqual([
        "Namespace",
        kind,
        ...owner,
        "Coverage",
        "Findings",
        "Fix published",
        "Last scan",
      ]);
      expect(
        await countOf(
          session,
          frame,
          `${BODY} > .Trivy-facts > dd button.Trivy-link, ${BODY} > .Trivy-facts > dd a`,
        ),
        "the workload and its owner are not links",
      ).toBe(1 + owner.length);

      for (const section of [
        "trivy-workload-findings",
        "trivy-workload-pods",
        "trivy-workload-containers",
        "trivy-workload-config",
      ]) {
        expect(
          await countOf(session, frame, `${BODY} [data-section="${section}"]`),
          `no ${section}`,
        ).toBe(1);
      }

      await closeDrawer(session, frame);
    }, 90_000);

    // settle.sh waits for unscannable's config audit; its image does not exist, so it is never scanned.
    it("says an unjudged workload is not known to be clean, and lists no findings", async () => {
      await openWorkloads(session, frame);

      const names = await column(session, frame, "Workload");
      const states = await column(session, frame, "Coverage");
      const index = names.findIndex((name) => name.startsWith("unscannable-"));

      expect(index, "the seed's unscannable is not listed").toBeGreaterThanOrEqual(0);
      expect(states[index]).toBe("Not looked at");
      expect(JUDGED_OR_INACTIVE).not.toContain(states[index]);

      await openRow(session, frame, index);
      await waitForPods(session, frame);

      expect(
        await textOf(session, frame, `${BODY} .Trivy-banner--critical .Trivy-banner__title`),
      ).toBe("Not looked at");
      expect(await textOf(session, frame, BODY)).toMatch(/does not mean it is clean/);
      expect(
        await countOf(session, frame, `${BODY} [data-section="trivy-workload-findings"]`),
      ).toBe(0);
      expect(
        await countOf(session, frame, `${BODY} [data-section="trivy-workload-commands"] code`),
        "no commands to look further",
      ).toBeGreaterThan(0);

      await closeDrawer(session, frame);
    }, 90_000);
  });

  describe("the workload drawer's views", () => {
    const TABS = `${BODY} [data-section="trivy-workload-findings"] .Trivy-filters`;
    const TABLE = `${BODY} [data-section="trivy-workload-findings"] .Trivy-table`;
    const TITLE = `${BODY} [data-section="trivy-workload-findings"] .Trivy-section__title`;

    beforeAll(async () => {
      await openScannedWorkload(session, frame);
    }, 90_000);

    afterAll(async () => {
      await closeDrawer(session, frame);
    }, 30_000);

    it("opens on packages and switches to findings", async () => {
      expect(await activeChip(session, frame, TABS)).toBe("By package");
      expect(await textOf(session, frame, TITLE)).toBe("Packages to upgrade");

      await pressChip(session, frame, `${TABS} button`, "All");

      const title = await waitFor("the findings title", async () => {
        const text = await textOf(session, frame, TITLE);

        return text === "Findings" ? text : undefined;
      });

      expect(title).toBe("Findings");

      // Only the findings table has a CVE column.
      const columns = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${TABLE} thead th`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      expect(columns).toContain("CVE");
    }, 90_000);

    it("narrows to what has no fix, and cannot show more than all of them", async () => {
      await pressChip(session, frame, `${TABS} button`, "All");
      const all = await countOf(session, frame, `${TABLE} tbody tr`);

      await pressChip(session, frame, `${TABS} button`, "No fix");

      expect(await activeChip(session, frame, TABS)).toContain("No fix");
      expect(await countOf(session, frame, `${TABLE} tbody tr`)).toBeLessThanOrEqual(all);

      const fixes = await session.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(`${TABLE} tbody tr td:last-child`)})]
           .map((each) => each.textContent.trim())`,
        frame,
      );

      for (const fix of fixes) expect(fix).toBe("none published");
    }, 90_000);

    it("copies a ticket from the title bar and says that it did", async () => {
      await session.evaluate(
        `[...(${shownDrawer(DRAWER)}?.querySelectorAll('.drawer-title i.Icon') ?? [])]
           .find((each) => !each.closest('.drawer-title-text') && each.textContent.trim() === "content_copy")?.click()`,
        frame,
      );

      // The clipboard needs a permission this frame lacks, so check the notification.
      expect(await notificationText(session, frame)).toMatch(/copied/i);
    }, 90_000);
  });

  // Last, so it covers every drawer and control above.
  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
