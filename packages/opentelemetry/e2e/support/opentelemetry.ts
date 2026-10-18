import { afterAll, afterEach, beforeAll, expect } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import {
  countOf,
  leaveNothingBehind,
  openWorkbench,
  type Workbench,
  waitFor,
} from "../../../../build/e2e/freelens";
import { CHIPS, DRAWER } from "./lists";

/** Opens the workbench once for a file; `take` hands the session and frame to the file's own variables. */
export function useWorkbench(take: (opened: Workbench) => void, clean = false) {
  let session: Session | undefined;
  let frame = 0;

  beforeAll(async () => {
    const opened = await openWorkbench();

    ({ session, frame } = opened);
    opened.errors.drain();
    take(opened);
  }, 180_000);

  if (clean) {
    afterEach(() =>
      leaveNothingBehind(session as Session, frame, "opentelemetry-overview", "opentelemetry"),
    );
  }

  afterAll(() => session?.close());
}

export const activeChip = (session: Session, frame: number) =>
  session.evaluate<string>(
    `[...document.querySelectorAll(${JSON.stringify(CHIPS)})]
       .find((each) => each.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? ""`,
    frame,
  );

export const terms = (session: Session, frame: number) =>
  session.evaluate<string[]>(
    `[...document.querySelectorAll('${DRAWER} .OpenTelemetry-facts dt')].map((each) => each.textContent)`,
    frame,
  );

export const factOf = (session: Session, frame: number, term: string) =>
  session.evaluate<string>(
    `[...document.querySelectorAll('${DRAWER} .OpenTelemetry-facts dt')].find((each) => each.textContent === ${JSON.stringify(term)})?.nextElementSibling?.textContent ?? ""`,
    frame,
  );

/** Clicks the drawer link ending in `ending` and checks the host list it lands on. */
export const follow = async (
  session: Session,
  frame: number,
  ending: string,
  path: string,
  name: string,
) => {
  const clicked = await session.evaluate<boolean>(
    `(() => {
      const link = [...document.querySelectorAll('${DRAWER} .OpenTelemetry-link')].find((each) => each.textContent.endsWith(${JSON.stringify(ending)}));
      link?.click();
      return Boolean(link);
    })()`,
    frame,
  );

  expect(clicked, `no link ending "${ending}"`).toBe(true);

  const landed = await waitFor(`the list behind "${ending}"`, async () => {
    const where = await session.evaluate<string>("location.pathname + location.search", frame);

    return where.includes(path) ? where : undefined;
  });

  expect(decodeURIComponent(landed)).toContain(`search=${name}`);
  expect(await countOf(session, frame, `${DRAWER} .OpenTelemetry-facts`)).toBe(0);

  const rows = await waitFor(`${name} in the host's list`, async () => {
    const texts = await session.evaluate<string[]>(
      `[...document.querySelectorAll(".TableRow")].map((each) => each.textContent)`,
      frame,
    );

    return texts.length > 0 ? texts : undefined;
  });

  expect(rows.every((each) => each.includes(name))).toBe(true);
};
