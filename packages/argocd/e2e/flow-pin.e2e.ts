import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";
import { showAllAttention } from "./attention";

/**
 * Pinning an Application, followed as far as the disk.
 *
 * This is the flow that shipped broken. Pins used to live in `localStorage`, and
 * the cluster frame's origin carries the proxy's port, which Freelens picks fresh
 * on every launch — so every restart wiped them, and the fix was one JSON file
 * per cluster in the folder the host hands the extension.
 *
 * A test that only read the screen would have passed against that bug: the pin
 * appears either way, and it is the next launch that loses it. So this one
 * follows the flow past the UI and reads the file, which is the part that had to
 * change. It cannot restart Freelens — the suite runs in a throwaway container
 * with no way to drive the app's own — but the file is the durable half, and it
 * is on a volume both containers share.
 *
 * It unpins at the end. A suite that leaves an Application pinned changes what
 * the next run sees, and that is how the sidebar tests came to pass for the wrong
 * reason.
 *
 * Needs a running workbench with remote debugging on. `make e2e` starts one.
 */

const EXTENSION_DATA = "/home/dev/.config/Freelens/extension_data";
const PINS_KEY = "freelens-addons.argocd.pins";

/**
 * What the extension has written for this cluster, or an empty list.
 *
 * The folder is named after the extension, which is a hash this test has no
 * business reconstructing, so every folder is searched for the cluster's file.
 */
function pinsOnDisk(clusterId: string): string[] {
  for (const folder of readdirSync(EXTENSION_DATA)) {
    const file = join(EXTENSION_DATA, folder, `${clusterId}.json`);

    try {
      const state = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const pins = state[PINS_KEY];

      if (Array.isArray(pins)) return pins as string[];
    } catch {
      // Not this extension's folder, or nothing written yet.
    }
  }

  return [];
}

describe("pinning an Application keeps it, past the screen", () => {
  let session: Session;
  let frame: number;
  let clusterId: string;

  beforeAll(async () => {
    ({ session, frame } = await openWorkbench());

    // The frame's own host names the cluster, which is how the extension decides
    // which file to write — so reading it the same way keeps the two in step.
    const host = await session.evaluate<string>("location.host", frame);

    clusterId = (host.split(":")[0] ?? "").split(".")[0] ?? "";
    expect(clusterId, "could not read a cluster id from the frame").toMatch(/^[0-9a-f]{8,}$/);
  }, 180_000);

  afterAll(() => session?.close());

  const pinIcons = () =>
    session.evaluate<number>(
      `document.querySelectorAll('[data-section="attention"] .ArgoCD-row__pin').length`,
      frame,
    );

  /** Every subline the overview shows, because the pinned count is one of several. */
  const sublines = () =>
    session.evaluate<string>(
      `[...document.querySelectorAll('.ArgoCD-page__subline')].map((p) => p.textContent.trim()).join(" | ")`,
      frame,
    );

  const openRowMenu = (name: string) =>
    session.evaluate<boolean>(
      `(() => {
        const row = [...document.querySelectorAll('[data-section="attention"] .ArgoCD-row')]
          .find((each) => each.textContent.includes(${JSON.stringify(name)}));
        const kebab = row?.querySelector('.ArgoCD-row__actions i.Icon');
        if (!kebab) return false;
        kebab.click();
        return true;
      })()`,
      frame,
    );

  const clickMenuItem = (label: string) =>
    session.evaluate<boolean>(
      `(() => {
        const item = [...document.querySelectorAll('.MenuItem')]
          .find((each) => each.textContent.includes(${JSON.stringify(label)}));
        if (!item) return false;
        item.click();
        return true;
      })()`,
      frame,
    );

  it("pins from the row's menu, shows it, and writes it where a restart will find it", async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");

    await showAllAttention(session, frame);

    const name = await textOf(session, frame, '[data-section="attention"] .ArgoCD-row__name b');

    expect(name.length, "no Application to pin").toBeGreaterThan(0);
    // A strict precondition on purpose: a run that tolerates finding it pinned
    // is a run that cannot tell pinning from having been pinned already.
    expect(
      pinsOnDisk(clusterId).some((pin) => pin.endsWith(`/${name}`)),
      `${name} is pinned already, so this cannot test pinning it`,
    ).toBe(false);

    expect(await openRowMenu(name), "the row has no menu").toBe(true);
    expect(await clickMenuItem("Pin to the top"), "the menu has no pin item").toBe(true);

    // On screen.
    const pinned = await waitFor("the pin to show on the row", async () =>
      (await pinIcons()) > 0 ? await pinIcons() : undefined,
    );

    expect(pinned).toBeGreaterThan(0);
    expect(await sublines()).toMatch(/\d+ pinned to the top/);

    // And on disk, which is the half that used to be lost on the next launch.
    // The write is queued behind whatever the extension is already writing, so
    // it is waited for rather than read once.
    const stored = await waitFor(`${name} in this cluster's state file`, async () => {
      const pins = pinsOnDisk(clusterId);

      return pins.some((pin) => pin.endsWith(`/${name}`)) ? pins : undefined;
    });

    // Namespaced, so pinning an Application called the same thing in another
    // namespace is a different pin.
    expect(stored.find((pin) => pin.endsWith(`/${name}`))).toMatch(/^[^/]+\/.+$/);

    // Leave the workbench as it was found.
    expect(await openRowMenu(name)).toBe(true);
    expect(await clickMenuItem("Unpin"), "the menu offers no way back").toBe(true);

    const cleared = await waitFor(`${name} gone from the state file`, async () =>
      pinsOnDisk(clusterId).some((pin) => pin.endsWith(`/${name}`)) ? undefined : true,
    );

    expect(cleared).toBe(true);
    expect(await pinIcons()).toBe(0);
  }, 300_000);
});
