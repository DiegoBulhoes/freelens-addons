import { describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { dialogColourViolations } from "../../../../build/e2e/design";
import {
  cancelDialog,
  clusterItems,
  countOf,
  dialogText,
  type ErrorLog,
  hoverForTooltip,
  notificationSaying,
  shownDrawer,
} from "../../../../build/e2e/freelens";
import { DRAWER, openWorkload, WORKLOAD_BODY } from "../support/lists";
import { useWorkbench } from "../support/opentelemetry";

// Read-only: every dialog is cancelled; the workloads and otel-late's Namespace must not change.

const WATCHED = [
  "/apis/apps/v1/namespaces/otel-apps/deployments",
  "/apis/apps/v1/namespaces/otel-late/deployments",
  "/apis/apps/v1/namespaces/otel-late/daemonsets",
  `/api/v1/namespaces?fieldSelector=${encodeURIComponent("metadata.name=otel-late")}`,
];

describe("an OpenTelemetry drawer", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  useWorkbench((opened) => ({ session, frame, errors } = opened), true);

  const toolbarIcon = (name: string) =>
    `[...(${shownDrawer(DRAWER)}?.querySelectorAll(".drawer-title i.Icon") ?? [])].find((each) => !each.closest(".drawer-title-text") && each.textContent.trim() === ${JSON.stringify(name)})`;

  const specs = async () => {
    const lists = await Promise.all(
      WATCHED.map((path) =>
        clusterItems<{
          metadata: { name: string; annotations?: Record<string, string> };
          spec?: unknown;
        }>(session, frame, path),
      ),
    );

    return JSON.stringify(
      lists.map((items) =>
        items.map((each) => [each.metadata.name, each.spec, each.metadata.annotations]).sort(),
      ),
    );
  };

  it("says what each title-bar action does", async () => {
    await openWorkload(session, frame, "otel-apps/checkout", "Deployment");

    for (const icon of ["content_copy", "restart_alt"]) {
      await session.evaluate(`${toolbarIcon(icon)}.setAttribute("data-hovered", "")`, frame);
      expect(await hoverForTooltip(session, frame, `${DRAWER} [data-hovered]`), icon).toMatch(/\w/);
      await session.evaluate(
        `document.querySelector('${DRAWER} [data-hovered]')?.removeAttribute("data-hovered")`,
        frame,
      );
    }
  }, 60_000);

  it("refuses to restart checkout, whose pods carry the agent, without opening a dialog", async () => {
    await openWorkload(session, frame, "otel-apps/checkout", "Deployment");
    await session.evaluate(`${toolbarIcon("restart_alt")}.click()`, frame);

    expect(await notificationSaying(session, frame, "checkout was not restarted")).toMatch(
      /Already injected/,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(await countOf(session, frame, ".ConfirmDialog")).toBe(0);
  }, 60_000);

  it("asks before restarting late, by its name, in the theme's colours, and writes nothing when cancelled", async () => {
    const before = await specs();

    await openWorkload(session, frame, "otel-late/late", "Deployment");
    await session.evaluate(`${toolbarIcon("restart_alt")}.click()`, frame);

    const dialog = await dialogText(session, frame);

    expect(dialog).toMatch(/Restart late\?/);
    expect(dialog).toMatch(/Rolls every pod of Deployment late/);
    expect(dialog).toMatch(/Type late to confirm/);
    expect(await dialogColourViolations(session, frame, "OpenTelemetry")).toEqual([]);

    await cancelDialog(session, frame);

    expect(await countOf(session, frame, WORKLOAD_BODY), "the drawer closed").toBeGreaterThan(0);
    expect(await specs()).toEqual(before);
  }, 90_000);

  it("copies the annotation to commit, and says so", async () => {
    await openWorkload(session, frame, "otel-late/late", "Deployment");
    await session.evaluate(`${toolbarIcon("content_copy")}.click()`, frame);

    // The clipboard needs a permission this frame lacks, so check the notification.
    expect(await notificationSaying(session, frame, "Annotation YAML copied")).toBeTruthy();
  }, 60_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
