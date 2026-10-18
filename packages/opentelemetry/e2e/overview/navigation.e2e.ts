import { describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, ROWS, SEARCH } from "../support/lists";
import { activeChip, useWorkbench } from "../support/opentelemetry";

const CARDS: [label: string, filter: string][] = [
  ["Restart needed", "restart-needed"],
  ["Not injected", "not-injected"],
  ["Injected", "injected"],
  ["Opted out", "opted-out"],
];

describe("the controls on the OpenTelemetry pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  useWorkbench((opened) => ({ session, frame, errors } = opened));

  const where = () =>
    session.evaluate<string>(
      "location.pathname.replace(/^\\/extension\\/[^/]+/, '') + location.search",
      frame,
    );

  const openOverview = async () => {
    await clickSidebar(session, frame, "opentelemetry-overview", "opentelemetry");
    await waitFor(
      "the cards",
      async () => (await countOf(session, frame, "button.OpenTelemetry-card")) > 0 || undefined,
    );
  };

  /** Presses the card with exactly this label; returns the number it shows. */
  const pressCard = async (label: string) => {
    const value = await session.evaluate<number>(
      `(() => {
        const card = [...document.querySelectorAll('button.OpenTelemetry-card')]
          .find((each) => each.querySelector('.OpenTelemetry-card__label')?.textContent.trim() === ${JSON.stringify(label)});
        if (!card) return -1;
        card.click();
        return Number(card.querySelector('.OpenTelemetry-card__value').textContent);
      })()`,
      frame,
    );

    if (value < 0) throw new Error(`no card labelled ${label}`);

    return value;
  };

  describe("the overview's cards", () => {
    it.each(CARDS)(
      "takes %s to the Coverage list on filter=%s, with as many rows as it counts",
      async (label, filter) => {
        await openOverview();

        const value = await pressCard(label);

        expect(value, `the seed has rows behind ${label}`).toBeGreaterThan(0);
        const landed = await waitFor(`the list behind ${label}`, async () => {
          const path = await where();

          return path.startsWith("/coverage") ? path : undefined;
        });

        expect(landed).toContain(`filter=${filter}`);
        expect(
          await waitFor(`${label} lit`, async () =>
            (await activeChip(session, frame)) === label ? label : undefined,
          ),
        ).toBe(label);

        // Read once the list has the count; a wrong count shows in the assertion, not as a timeout.
        await waitFor(
          "the rows",
          async () => ((await countOf(session, frame, ROWS)) === value ? true : undefined),
          10_000,
        ).catch(() => undefined);
        expect(await countOf(session, frame, ROWS)).toBe(value);
      },
      90_000,
    );

    it("takes Collectors not ready to the Collectors list", async () => {
      await openOverview();
      await pressCard("Collectors not ready");

      expect(
        await waitFor("the Collectors list", async () => {
          const path = await where();

          return path.startsWith("/collectors") ? path : undefined;
        }),
      ).toMatch(/^\/collectors/);
    }, 90_000);
  });

  describe("the Needs attention rows", () => {
    it.each([
      ["a workload", "/coverage", false],
      ["a collector", "/collectors", true],
    ] as const)(
      "open %s's own drawer on its list, the list unsearched",
      async (_, page, collector) => {
        await openOverview();

        const clicked = await session.evaluate<{ name: string; meta: string }>(
          `(() => {
            const row = [...document.querySelectorAll('[data-section="opentelemetry-attention"] .OpenTelemetry-row')]
              .find((each) => (each.querySelector('.OpenTelemetry-row__meta')?.textContent ?? "").startsWith("OpenTelemetryCollector") === ${collector});
            row?.click();
            return {
              name: row?.querySelector('b')?.textContent.trim() ?? "",
              meta: row?.querySelector('.OpenTelemetry-row__meta')?.textContent.trim() ?? "",
            };
          })()`,
          frame,
        );

        expect(clicked.name, `no attention row for ${page}`).not.toBe("");

        const [kind = "", namespace = ""] = clicked.meta.split(" · ");
        const landed = await waitFor(`the list behind ${clicked.name}`, async () => {
          const at = await where();

          return at.startsWith(page) ? at : undefined;
        });
        const params = new URLSearchParams(landed.slice(landed.indexOf("?")));

        expect([params.get("namespace"), params.get("name")]).toEqual([namespace, clicked.name]);

        const title = await waitFor(`${clicked.name}'s drawer`, async () => {
          const shown = await drawerTitle(session, frame, DRAWER);

          return shown || undefined;
        });

        expect(title).toBe(`${kind}: ${clicked.name}`);
        expect(
          await session.evaluate<string>(
            `document.querySelector(${JSON.stringify(SEARCH)})?.value ?? ""`,
            frame,
          ),
        ).toBe("");
      },
      90_000,
    );
  });

  it("drives all of that without logging an error", () => {
    const logged = errors.drain();

    for (const error of logged) console.log(`  ${error.source}: ${error.text.slice(0, 200)}`);

    expect(logged).toEqual([]);
  });
});
