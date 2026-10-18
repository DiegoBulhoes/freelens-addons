import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import {
  ATTENTION_ROWS,
  pinnedNames,
  pressRowMenu,
  showAllAttention,
  unpin,
  unpinQuietly,
} from "../support/attention";

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
  let errors: ErrorLog;
  let clusterId: string;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();

    // The extension names its file after the frame's host, so read it the same way.
    const host = await session.evaluate<string>("location.host", frame);

    clusterId = (host.split(":")[0] ?? "").split(".")[0] ?? "";
    expect(clusterId, "could not read a cluster id from the frame").toMatch(/^[0-9a-f]{8,}$/);
  }, 180_000);

  afterAll(() => session?.close());

  const sublines = () =>
    session.evaluate<string>(
      `[...document.querySelectorAll('.ArgoCD-page__subline')].map((p) => p.textContent.trim()).join(" | ")`,
      frame,
    );

  const onDisk = (name: string) => pinsOnDisk(clusterId).some((pin) => pin.endsWith(`/${name}`));

  it("pins from the row's menu, shows it, and writes it where a restart will find it", async () => {
    await clickSidebar(session, frame, "argocd-dashboard", "argocd");

    await showAllAttention(session, frame);

    // A pin left by an earlier run, or one of the operator's own, is not this test's to clear.
    const before = await pinnedNames(session, frame);
    const name = await session.evaluate<string>(
      `[...document.querySelectorAll('${ATTENTION_ROWS}')]
         .find((row) => !row.querySelector('.ArgoCD-row__pin'))
         ?.querySelector('.ArgoCD-row__name b')?.textContent.trim() ?? ''`,
      frame,
    );

    expect(name.length, "no unpinned Application to pin").toBeGreaterThan(0);
    expect(onDisk(name), `${name} shows no pin but the state file has one`).toBe(false);

    try {
      expect(await pressRowMenu(session, frame, name, "Pin to the top"), "no pin item").toBe(true);

      await waitFor(`${name}'s pin to show`, async () =>
        (await pinnedNames(session, frame)).includes(name) ? true : undefined,
      );
      expect(await sublines()).toMatch(/\d+ pinned to the top/);

      // The write is queued behind others, so wait for it.
      const stored = await waitFor(`${name} in this cluster's state file`, async () => {
        const pins = pinsOnDisk(clusterId);

        return pins.some((pin) => pin.endsWith(`/${name}`)) ? pins : undefined;
      });

      // Pins are namespace/name.
      expect(stored.find((pin) => pin.endsWith(`/${name}`))).toMatch(/^[^/]+\/.+$/);

      await unpin(session, frame, name);
      await waitFor(`${name} gone from the state file`, async () =>
        onDisk(name) ? undefined : true,
      );
      expect((await pinnedNames(session, frame)).sort()).toEqual([...before].sort());
    } finally {
      await unpinQuietly(session, frame, name);
    }
  }, 300_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
