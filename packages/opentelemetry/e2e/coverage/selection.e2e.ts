import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { designViolations, dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clickWhenShown,
  countOf,
  dialogText,
  type ErrorLog,
  leaveNothingBehind,
  notificationSaying,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { appPodsOf, hasAgent, LIST, openCoverage, tick, WORKLOAD_BODY } from "../support/lists";

// Read-only: each bulk restart is cancelled, or confirmed with the wrong word.

describe("ticking several workloads", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterEach(() => leaveNothingBehind(session, frame, "opentelemetry-overview", "opentelemetry"));

  afterAll(() => session?.close());

  const tickAll = () =>
    session.evaluate(
      `document.querySelector('${LIST} thead .OpenTelemetry-table__check input').click()`,
      frame,
    );

  it("offers Restart once rows are ticked, without opening a drawer", async () => {
    await openCoverage(session, frame);
    await tick(session, frame, "otel-late/late");

    const labels = await waitFor("the selection bar", async () => {
      const found = await session.evaluate<string[]>(
        `[...document.querySelectorAll('[data-section="selection"] button')].map((each) => each.textContent.trim())`,
        frame,
      );

      return found.length > 0 ? found : undefined;
    });

    expect(labels).toEqual(["Restart"]);
    expect(await countOf(session, frame, WORKLOAD_BODY)).toBe(0);
    expect(await designViolations(session, frame, "OpenTelemetry")).toEqual([]);
  }, 60_000);

  it("lists the rows a restart helps, and names the rest with the reason", async () => {
    await openCoverage(session, frame);
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Restart \d+ workloads?\?/);
    expect(dialog).toContain("otel-late/late");
    expect(dialog).toMatch(/Skipped: .*otel-apps\/checkout \(Already injected\.\)/);
    expect(dialog).toContain("otel-batch/nightly (A CronJob has no restart");
    expect(dialog).toMatch(/Type confirm to confirm/);
    expect(await dialogColourViolations(session, frame, "OpenTelemetry")).toEqual([]);

    await cancelDialog(session, frame);
  }, 60_000);

  it("restarts nothing when the wrong word is typed", async () => {
    const pods = async () => {
      const found = await appPodsOf(session, frame, "otel-late/late");

      return {
        uids: found.map((each) => each.metadata.uid).sort(),
        injected: found.filter(hasAgent).length,
      };
    };
    const before = await pods();

    expect(before.uids.length, "late has no pods").toBeGreaterThan(0);
    expect(before.injected, "late's pods already carry the agent").toBe(0);

    await openCoverage(session, frame);
    await tickAll();
    await clickWhenShown(session, frame, '[data-section="selection"] button', "Restart");

    expect(await dialogText(session, frame)).toMatch(/Restart \d+ workloads?\?/);

    await typeInto(session, frame, '.ConfirmDialog input[aria-label="Confirmation"]', "not-it");
    await session.evaluate(
      `[...document.querySelectorAll('.ConfirmDialog button')].find((each) => each.textContent.startsWith("Restart"))?.click()`,
      frame,
    );

    expect(await notificationSaying(session, frame, 'Nothing was changed: "confirm"')).toBeTruthy();
    expect(await pods()).toEqual(before);
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
