import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { countOf, type ErrorLog, openWorkbench, waitFor } from "../../../../build/e2e/freelens";
import {
  activeChip,
  chipLabel,
  LISTS,
  openList,
  pressChip,
  rowNamed,
  rowsOf,
  untilLive,
} from "../support/lists";
import { controlReads } from "../support/prometheus";

type Chipped = "monitors" | "rules" | "instances";

// The states each chip keeps, as the rows name them, and seed rows it must show.
const CHIP_STATES: [list: Chipped, chip: string, states: string[], pinned: string[]][] = [
  ["monitors", "Down", ["Down"], ["monitoring/down-path"]],
  [
    "monitors",
    "Not selected",
    ["Not selected", "Namespace excluded"],
    ["prom-apps/orphan", "prom-outside/excluded"],
  ],
  [
    "monitors",
    "No target",
    ["No target", "Port missing", "No endpoints"],
    ["prom-apps/no-service", "prom-apps/wrong-port", "prom-apps/no-endpoints"],
  ],
  ["monitors", "Rejected or not loaded", ["Rejected", "Not loaded"], ["monitoring/rejected"]],
  ["monitors", "Healthy", ["Healthy"], ["monitoring/prom-self", "prom-apps/static-self"]],
  [
    "rules",
    "Firing or pending",
    ["Firing", "Pending"],
    ["prom-apps/always-firing", "prom-apps/pending-rule"],
  ],
  [
    "rules",
    "Not loaded",
    ["Not selected", "Namespace excluded", "Not loaded"],
    ["prom-apps/unselected-rule", "prom-outside/excluded-rule"],
  ],
  [
    "rules",
    "Rejected or failing",
    ["Rejected", "Evaluation failing"],
    ["prom-apps/broken-rule", "prom-apps/failing-rule"],
  ],
  ["rules", "Loaded", ["Loaded"], ["prom-apps/recording"]],
  [
    "instances",
    "Needs attention",
    ["Not available", "Not reconciled", "No Alertmanager", "Degraded"],
    ["prom-broken/no-image"],
  ],
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

  const { states } = controlReads(() => ({ session, frame }));

  describe("the chips", () => {
    it.each(["monitors", "rules", "instances"] as const)(
      "on %s start on All; each lights alone, shows as many rows as its count and no more than All",
      async (name) => {
        const list = LISTS[name];

        await openList(session, frame, list);
        await untilLive(session, frame, list.section);

        const chips = list.chips;
        const rows = rowsOf(list.section);

        expect(await activeChip(session, frame, chips)).toBe("All");

        const all = await countOf(session, frame, rows);
        const labels = await session.evaluate<string[]>(
          `[...document.querySelectorAll(${JSON.stringify(chips)})].map((each) => ${chipLabel("each")})`,
          frame,
        );

        expect(labels.length).toBeGreaterThan(1);

        for (const label of labels.slice(1)) {
          await pressChip(session, frame, chips, label);

          const counted = await session.evaluate<number>(
            `Number([...document.querySelectorAll(${JSON.stringify(chips)})]
               .find((each) => each.getAttribute("aria-pressed") === "true")
               ?.querySelector(".Prometheus-filter__count")?.textContent ?? -1)`,
            frame,
          );

          expect(await activeChip(session, frame, chips)).toBe(label);
          expect(
            await countOf(session, frame, rows),
            `${label} showed more than All`,
          ).toBeLessThanOrEqual(all);
          expect(await countOf(session, frame, rows), `${label}'s count`).toBe(counted);
        }

        await pressChip(session, frame, chips, "All");
        expect(await countOf(session, frame, rows)).toBe(all);
      },
      120_000,
    );

    it.each(CHIP_STATES)(
      "on %s keep under %s only the rows in its states, the seed's among them",
      async (name, chip, kept, pinned) => {
        const list = LISTS[name];

        await openList(session, frame, list);
        await untilLive(session, frame, list.section);
        await pressChip(session, frame, list.chips, chip);

        // An empty list keeps no wrong state, so the seed's rows must be there.
        let missing = pinned;

        await waitFor(
          `${chip}'s seed rows`,
          async () => {
            const absent: string[] = [];

            for (const key of pinned) {
              const shown = await session.evaluate<boolean>(
                `Boolean(${rowNamed(list.section, key)})`,
                frame,
              );

              if (!shown) absent.push(key);
            }
            missing = absent;

            return absent.length === 0 ? true : undefined;
          },
          30_000,
        ).catch(() => undefined);

        expect(missing, `${chip} lacks seed rows`).toEqual([]);

        const shown = await states(list.section);

        expect(shown.length).toBeGreaterThan(0);
        expect(
          shown.filter((each) => !kept.includes(each)),
          chip,
        ).toEqual([]);
        await pressChip(session, frame, list.chips, "All");
      },
      120_000,
    );
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
