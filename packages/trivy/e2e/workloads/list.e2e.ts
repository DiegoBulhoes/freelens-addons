import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  type ErrorLog,
  openWorkbench,
  pressChip,
  pressSort,
} from "../../../../build/e2e/freelens";
import { activeChip, chipCount, JUDGED_OR_INACTIVE } from "../support/trivy";
import { CHIPS, column, openWorkloads, ROW } from "../support/workloads";

describe("the controls on the Trivy pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  describe("the workload list's filter chips", () => {
    beforeAll(async () => {
      await openWorkloads(session, frame);
    }, 90_000);

    it("starts on All, and All is the widest", async () => {
      expect(await activeChip(session, frame, CHIPS)).toBe("All");

      const all = await countOf(session, frame, ROW);

      for (const chip of ["No verdict", "Findings"]) {
        await pressChip(session, frame, `${CHIPS} button`, chip);

        expect(
          await activeChip(session, frame, CHIPS),
          `${chip} did not become the active chip`,
        ).toBe(chip);

        // Compared with All, not a number: a number would be this cluster's contents.
        expect(
          await countOf(session, frame, ROW),
          `${chip} showed more than All`,
        ).toBeLessThanOrEqual(all);
        expect(
          await chipCount(session, frame, CHIPS, chip),
          `${chip} counts other rows than it shows`,
        ).toBe(await countOf(session, frame, ROW));
      }

      await pressChip(session, frame, `${CHIPS} button`, "All");
      expect(await countOf(session, frame, ROW)).toBe(all);
      expect(await chipCount(session, frame, CHIPS, "All")).toBe(all);
    }, 90_000);

    it("shows under No verdict exactly the workloads All marks as unjudged", async () => {
      const unjudged = async () => {
        const names = await column(session, frame, "Workload");
        const states = await column(session, frame, "Coverage");

        return names.filter((_, at) => !JUDGED_OR_INACTIVE.includes(states[at] ?? ""));
      };

      await pressChip(session, frame, `${CHIPS} button`, "All");
      const expected = await unjudged();

      // Compared with the list, not non-empty: a fully scanned cluster has none.
      await pressChip(session, frame, `${CHIPS} button`, "No verdict");

      try {
        expect(await countOf(session, frame, ROW)).toBe(expected.length);
        expect(await unjudged()).toEqual(expected);
      } finally {
        await pressChip(session, frame, `${CHIPS} button`, "All");
      }
    }, 90_000);

    it("sorts by criticals both ways, then back to its own order", async () => {
      const original = await column(session, frame, "Workload");
      const sortBy = () =>
        pressSort(session, frame, ".Trivy-page--list .Trivy-table thead .Trivy-sort", "Critical");
      // An unjudged workload has no count, and goes last either way.
      const counts = async () =>
        (await column(session, frame, "Critical")).filter((each) => each !== "—").map(Number);

      await sortBy();
      const ascending = await counts();

      expect(ascending).toEqual([...ascending].sort((first, second) => first - second));

      await sortBy();
      const descending = await counts();

      expect(descending).toEqual([...descending].sort((first, second) => second - first));
      const cells = await column(session, frame, "Critical");

      if (cells.includes("—")) expect(cells.at(-1), "an unjudged count sorted first").toBe("—");

      await sortBy();
      expect(await column(session, frame, "Workload")).toEqual(original);
    }, 90_000);
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});

describe("what the Trivy pages say", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  it("orders the list by state, then by how bad it is, until a header is clicked", async () => {
    await openWorkloads(session, frame);

    const states = await column(session, frame, "Coverage");
    const criticals = await column(session, frame, "Critical");
    const highs = await column(session, frame, "High");
    const named = {
      Scanned: "scanned",
      "No verdict": "read-but-no-verdict",
      "Not looked at": "never-looked",
      "Scaled away": "inactive",
    };
    const rows = states.map((state, at) => ({
      state: named[state as keyof typeof named] ?? "",
      critical: Number.parseInt(criticals[at] ?? "", 10) || 0,
      high: Number.parseInt(highs[at] ?? "", 10) || 0,
    }));

    expect(rows.length).toBeGreaterThan(1);

    const rank = { "never-looked": 0, "read-but-no-verdict": 1, scanned: 2, inactive: 3 } as const;

    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1];
      const current = rows[index];

      if (previous === undefined || current === undefined) continue;

      const previousRank = rank[previous.state as keyof typeof rank] ?? 99;
      const currentRank = rank[current.state as keyof typeof rank] ?? 99;

      expect(
        previousRank,
        `row ${index} is in a state that should sort earlier`,
      ).toBeLessThanOrEqual(currentRank);

      if (previousRank !== currentRank) continue;

      if (previous.critical !== current.critical) {
        expect(
          previous.critical,
          `row ${index} has more criticals than the row above`,
        ).toBeGreaterThan(current.critical);
      } else {
        expect(
          previous.high,
          `row ${index} has more highs than the row above`,
        ).toBeGreaterThanOrEqual(current.high);
      }
    }
  }, 150_000);

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
