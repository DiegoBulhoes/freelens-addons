import { describe, expect, it } from "vitest";

import {
  applicationMenuEntries,
  MAX_ROLLBACK_TARGETS,
  rollbackTooltip,
} from "../../src/renderer/api/applications/application-menu";
import { autoSyncOf, deployOf, rollbackPatch } from "../../src/renderer/api/writes/patches";
import { application, statusOf, variantOf } from "../support/fixtures";

const kinds = (object: Parameters<typeof applicationMenuEntries>[0]) =>
  applicationMenuEntries(object).map((entry) => entry.kind);

const WRITES = new Set(["resume-auto-sync", "sync", "terminate", "rollback"]);

function writesFollowPin(entries: string[]): boolean {
  const pin = entries.indexOf("pin");

  return pin >= 0 && entries.every((kind, index) => !WRITES.has(kind) || index > pin);
}

describe("the Application menu", () => {
  it("puts reads and copies first, then Pin, then Sync, with roll back last", () => {
    expect(kinds(application("guestbook"))).toEqual([
      "logs",
      "refresh",
      "hard-refresh",
      "compare",
      "copy-sync",
      "copy-patch",
      "copy-summary",
      "pin",
      "sync",
      ...Array(MAX_ROLLBACK_TARGETS).fill("rollback"),
    ]);
  });

  it("puts Terminate after Pin while a sync runs, and offers neither Sync nor roll back", () => {
    const running = variantOf("guestbook", (data) => {
      (statusOf(data).operationState as Record<string, unknown>).phase = "Running";
    });
    const entries = kinds(running);

    expect(entries.slice(-2)).toEqual(["pin", "terminate"]);
    expect(entries).not.toContain("sync");
    expect(entries).not.toContain("rollback");
  });

  it("puts Resume auto-sync among the writes after Pin", () => {
    const deploy = deployOf(application("guestbook"), 21);

    if (!deploy) throw new Error("guestbook has no deploy #21 in the fixtures");

    const rolledBack = variantOf("guestbook", (data) => {
      const patch = rollbackPatch(deploy, { autoSync: autoSyncOf(application("guestbook")) });

      data.metadata.annotations = {
        ...(data.metadata.annotations as Record<string, string> | undefined),
        ...patch.metadata?.annotations,
      };
      (data.spec.syncPolicy as Record<string, unknown>).automated = null;
    });
    const entries = kinds(rolledBack);

    expect(entries.slice(entries.indexOf("pin"), entries.indexOf("pin") + 3)).toEqual([
      "pin",
      "resume-auto-sync",
      "sync",
    ]);
    expect(entries.at(-1)).toBe("rollback");
    expect(writesFollowPin(entries)).toBe(true);
  });

  it("offers no git diff or roll back with a single deploy", () => {
    const entries = kinds(application("podinfo"));

    expect(entries).not.toContain("compare");
    expect(entries).not.toContain("rollback");
    expect(entries.at(-1)).toBe("sync");
    expect(writesFollowPin(entries)).toBe(true);
  });

  it("says a roll back turns automated sync off only when it is on", () => {
    const paused = variantOf("guestbook", (data) => {
      (data.spec.syncPolicy as Record<string, unknown>).automated = { enabled: false };
    });

    expect(rollbackTooltip(application("guestbook"))).toBe(
      "Syncs this deploy's revisions and sources, and turns automated sync off",
    );
    expect(rollbackTooltip(application("helm-guestbook"))).toBe(
      "Syncs this deploy's revisions and sources",
    );
    expect(rollbackTooltip(paused)).not.toContain("automated sync");
  });
});
