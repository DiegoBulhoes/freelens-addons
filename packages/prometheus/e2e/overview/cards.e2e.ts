import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { countOf, type ErrorLog, openWorkbench, waitFor } from "../../../../build/e2e/freelens";
import { activeChip, LISTS, rowsOf, untilLive } from "../support/lists";
import { controlReads } from "../support/prometheus";

type Chipped = "monitors" | "rules" | "instances";

// Card label, the list it opens, its filter and the chip that lights there.
const CARDS: [label: string, list: Chipped, filter: string, chip: string][] = [
  ["Monitors down", "monitors", "down", "Down"],
  ["Monitors with no target", "monitors", "no-target", "No target"],
  ["Monitors not selected", "monitors", "not-selected", "Not selected"],
  ["Monitors rejected or not loaded", "monitors", "rejected", "Rejected or not loaded"],
  ["Rules rejected or failing", "rules", "rejected", "Rejected or failing"],
  ["Rules firing or pending", "rules", "firing", "Firing or pending"],
  ["Rules not loaded", "rules", "not-loaded", "Not loaded"],
  ["Instances needing attention", "instances", "attention", "Needs attention"],
];

describe("the controls on the Prometheus pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { where, openOverview, pressCard } = controlReads(() => ({ session, frame }));

  describe("the overview's cards", () => {
    it.each(CARDS)(
      "takes %s to the %s list on filter=%s, with as many rows as it counts",
      async (label, name, filter, chip) => {
        const list = LISTS[name];
        const rows = rowsOf(list.section);

        await openOverview();
        // The live read changes the counts once; read them after it.
        await untilLive(session, frame, ".Prometheus-card");

        const { value, title } = await pressCard(label);

        expect(title).toMatch(/^Opens /);
        const landed = await waitFor(`the list behind ${label}`, async () => {
          const at = await where();

          return at.startsWith(`/${name}`) ? at : undefined;
        });

        expect(landed).toContain(`filter=${filter}`);

        expect(
          await waitFor(`${chip} lit`, async () =>
            (await activeChip(session, frame, list.chips)) === chip ? chip : undefined,
          ),
        ).toBe(chip);
        await untilLive(session, frame, list.section);

        // A wrong count shows in the assertion, not as a timeout.
        await waitFor(
          "the rows",
          async () => ((await countOf(session, frame, rows)) === value ? true : undefined),
          10_000,
        ).catch(() => undefined);
        expect(await countOf(session, frame, rows)).toBe(value);
      },
      90_000,
    );
  });

  it("renders all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
