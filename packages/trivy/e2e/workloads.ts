import type { Session } from "../../../build/e2e/cdp";
import { clickSidebar, drawerTitle as titleOf, waitFor } from "../../../build/e2e/freelens";

export const ROW = '.Trivy-page--list > [data-section="list"] .Trivy-table > tbody > tr';
export const CHIPS = ".Trivy-page--list > .Trivy-filters";
export const SEARCH = ".Trivy-page--list .Trivy-page__actions .Trivy-search";
export const EMPTY = '.Trivy-page--list > [data-section="list"] > .Trivy-section__note';
export const DRAWER = ".TrivyObjectDrawer";
export const BODY = `${DRAWER} [data-section="trivy-workload"]`;

const count = (session: Session, frame: number, selector: string) =>
  session.evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`, frame);

export async function openWorkloads(session: Session, frame: number): Promise<number> {
  await clickSidebar(session, frame, "trivy-workloads", "trivy");

  return waitFor("the workload list", async () => {
    const rows = await count(session, frame, ROW);

    return rows > 0 ? rows : undefined;
  });
}

// The cells of one column, by its header, in the order shown.
export function column(session: Session, frame: number, title: string): Promise<string[]> {
  return session.evaluate<string[]>(
    `(() => {
      const table = document.querySelector('.Trivy-page--list > [data-section="list"] .Trivy-table');
      if (!table) return [];
      const at = [...table.querySelectorAll('thead th')]
        .map((each) => each.textContent.replace(/[▲▼]/g, "").trim())
        .indexOf(${JSON.stringify(title)});
      return [...table.querySelectorAll(':scope > tbody > tr')]
        .map((row) => row.children[at]?.textContent.trim() ?? "");
    })()`,
    frame,
  );
}

export async function openRow(session: Session, frame: number, index: number): Promise<string> {
  const name = await session.evaluate<string>(
    `(() => {
      const row = document.querySelectorAll(${JSON.stringify(ROW)})[${index}];
      if (!row) return "";
      row.click();
      return row.children[0].textContent.trim();
    })()`,
    frame,
  );

  if (name === "") throw new Error(`no workload row ${index}`);

  await waitFor(`${name}'s drawer`, async () =>
    (await drawerTitle(session, frame)).endsWith(`: ${name}`) &&
    (await count(session, frame, BODY)) > 0
      ? true
      : undefined,
  );

  return name;
}

export function drawerTitle(session: Session, frame: number): Promise<string> {
  return titleOf(session, frame, DRAWER);
}

export async function closeDrawer(session: Session, frame: number): Promise<void> {
  await session.evaluate(
    `[...document.querySelectorAll(${JSON.stringify(`${DRAWER} .drawer-title i.Icon`)})]
       .find((each) => each.textContent.trim() === "close")?.click()`,
    frame,
  );
  await waitFor("the drawer to close", async () =>
    (await count(session, frame, BODY)) === 0 ? true : undefined,
  );
}

// A scanned row with a critical or high finding: the first rows are the unjudged ones.
export async function openScannedWorkload(session: Session, frame: number): Promise<string> {
  await openWorkloads(session, frame);

  const coverage = await column(session, frame, "Coverage");
  const critical = await column(session, frame, "Critical");
  const high = await column(session, frame, "High");
  const index = coverage.findIndex(
    (state, at) => state === "scanned" && Number(critical[at]) + Number(high[at]) > 0,
  );

  if (index < 0) throw new Error("no scanned workload with critical or high findings");

  const name = await openRow(session, frame, index);

  await waitFor("its findings", async () =>
    (await count(
      session,
      frame,
      `${DRAWER} [data-section="trivy-workload-findings"] .Trivy-table`,
    )) > 0
      ? true
      : undefined,
  );

  return name;
}
