import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, openWorkbench, textOf, waitFor } from "../../../build/e2e/freelens";
import { showAllAttention } from "./attention";

// Reads the state file too: the screen shows a pin either way, it is the next launch that loses it.

const EXTENSION_DATA = "/home/dev/.config/Freelens/extension_data";
const PINS_KEY = "freelens-addons.argocd.pins";

/** The folder name is a hash of the extension, so every folder is searched. */
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

    // The extension names its file after the frame's host, so read it the same way.
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
    expect(
      pinsOnDisk(clusterId).some((pin) => pin.endsWith(`/${name}`)),
      `${name} is pinned already, so this cannot test pinning it`,
    ).toBe(false);

    expect(await openRowMenu(name), "the row has no menu").toBe(true);
    expect(await clickMenuItem("Pin to the top"), "the menu has no pin item").toBe(true);

    const pinned = await waitFor("the pin to show on the row", async () =>
      (await pinIcons()) > 0 ? await pinIcons() : undefined,
    );

    expect(pinned).toBeGreaterThan(0);
    expect(await sublines()).toMatch(/\d+ pinned to the top/);

    // The write is queued behind others, so wait for it.
    const stored = await waitFor(`${name} in this cluster's state file`, async () => {
      const pins = pinsOnDisk(clusterId);

      return pins.some((pin) => pin.endsWith(`/${name}`)) ? pins : undefined;
    });

    // Pins are namespace/name.
    expect(stored.find((pin) => pin.endsWith(`/${name}`))).toMatch(/^[^/]+\/.+$/);

    expect(await openRowMenu(name)).toBe(true);
    expect(await clickMenuItem("Unpin"), "the menu offers no way back").toBe(true);

    const cleared = await waitFor(`${name} gone from the state file`, async () =>
      pinsOnDisk(clusterId).some((pin) => pin.endsWith(`/${name}`)) ? undefined : true,
    );

    expect(cleared).toBe(true);
    expect(await pinIcons()).toBe(0);
  }, 300_000);
});
