import { expect } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";
import { clickSidebar, countOf, waitFor } from "../../../../build/e2e/freelens";
import { clickDrawerClose, DRAWER } from "./lists";

export const where = (session: Session, frame: number) =>
  session.evaluate<string>(
    "location.pathname.replace('/extension/freelens-addons--cert-manager', '') + location.search",
    frame,
  );

export const drawerOpen = (session: Session, frame: number, section: string) =>
  waitFor(`${section}'s drawer`, async () =>
    (await countOf(session, frame, `${DRAWER} [data-section="${section}"]`)) > 0 ? true : undefined,
  );

export const closeDrawer = (session: Session, frame: number, section?: string) =>
  clickDrawerClose(session, frame).then(() =>
    waitFor("the drawer to close", async () =>
      (await countOf(
        session,
        frame,
        `${DRAWER} [data-section${section ? `="${section}"` : ""}]`,
      )) === 0
        ? true
        : undefined,
    ),
  );

/** Clicks a cell that is not the checkbox's, as a person opening the row would. */
export const openRow = async (
  session: Session,
  frame: number,
  page: string,
  list: string,
  section: string,
  predicate = "true",
) => {
  await clickSidebar(session, frame, page, "cert-manager");
  await waitFor(`${list}'s rows`, async () =>
    (await countOf(session, frame, `[data-section="${list}"] tbody tr`)) > 0 ? true : undefined,
  );

  const name = await session.evaluate<string>(
    `(() => {
      const row = [...document.querySelectorAll('[data-section="${list}"] tbody tr')].find((each) => ${predicate});
      const cell = row?.querySelector('td:not(.CertManager-table__check)');
      cell?.click();
      return cell?.textContent.trim() ?? "";
    })()`,
    frame,
  );

  expect(name, `no row on ${list} matches ${predicate}`).not.toBe("");
  await drawerOpen(session, frame, section);
};
