import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";
import { DRAWER, INSTANCES, MONITORS, RULES, rowsOf, SEARCH } from "../support/lists";
import { controlReads } from "../support/prometheus";

describe("the controls on the Prometheus pages", () => {
  let session: Session;
  let frame: number;
  let errors: ErrorLog;

  beforeAll(async () => {
    ({ session, frame, errors } = await openWorkbench());
    errors.drain();
  }, 180_000);

  afterAll(() => session?.close());

  const { where, rowTexts, openOverview } = controlReads(() => ({ session, frame }));

  describe("the Needs attention rows", () => {
    it.each([
      ["a monitor", "/monitors", MONITORS, "^(ServiceMonitor|PodMonitor|ScrapeConfig) · "],
      ["a rule", "/rules", RULES, "^PrometheusRule · "],
      ["an instance", "/instances", INSTANCES, "^(Prometheus|PrometheusAgent|Alertmanager) · "],
    ] as const)(
      "open %s's drawer, its list searched by its name",
      async (_, page, section, meta) => {
        await openOverview();

        const name = await waitFor(`an attention row for ${page}`, async () => {
          const found = await session.evaluate<string>(
            `(() => {
              const row = [...document.querySelectorAll('[data-section="prometheus-attention"] .Prometheus-row')]
                .find((each) => new RegExp(${JSON.stringify(meta)}).test(each.querySelector('.Prometheus-row__meta')?.textContent ?? ""));
              row?.click();
              return row?.querySelector('b')?.textContent.trim() ?? "";
            })()`,
            frame,
          );

          return found || undefined;
        });

        await waitFor(`the list behind ${name}`, async () =>
          (await where()).startsWith(page) ? true : undefined,
        );

        const search = await waitFor("the search box", async () => {
          const value = await session.evaluate<string>(
            `document.querySelector(${JSON.stringify(SEARCH)})?.value ?? ""`,
            frame,
          );

          return value || undefined;
        });

        expect(search).toBe(name);

        const shown = await waitFor("the searched rows", async () => {
          const found = await rowTexts(rowsOf(section));

          return found.length > 0 ? found : undefined;
        });

        expect(shown.every((each) => each.includes(name))).toBe(true);
        expect(
          await waitFor(`${name}'s drawer`, async () => {
            const title = await drawerTitle(session, frame, DRAWER);

            return title.endsWith(`: ${name}`) ? title : undefined;
          }),
        ).toMatch(new RegExp(meta.replace(" · ", ":")));
        await typeInto(session, frame, SEARCH, "");
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
