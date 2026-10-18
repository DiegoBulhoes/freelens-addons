import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  type ErrorLog,
  openWorkbench,
  waitFor,
} from "../../../../build/e2e/freelens";

export const DRAWER = ".MongoDBObjectDrawer";
export const LIST = '[data-section="mongodb-clusters"]';
export const ROWS = `${LIST} tbody tr`;
export const CHIPS = '[data-section="mongodb-cluster-filters"] .MongoDB-filter';
export const PATH = "/apis/mongodbcommunity.mongodb.com/v1/mongodbcommunity";

export const openSuite = async (): Promise<{
  session: Session;
  frame: number;
  errors: ErrorLog;
}> => {
  const opened = await openWorkbench();

  opened.errors.drain();

  return opened;
};

export const pagesOn = (at: () => { session: Session; frame: number }) => {
  const where = () => {
    const { session, frame } = at();

    return session.evaluate<string>(
      "location.pathname.replace(/^\\/extension\\/[^/]+/, '') + location.search",
      frame,
    );
  };

  // Without the count each chip carries.
  const activeChip = () => {
    const { session, frame } = at();

    return session.evaluate<string>(
      `[...document.querySelectorAll(${JSON.stringify(CHIPS)})]
         .find((each) => each.getAttribute("aria-pressed") === "true")?.firstChild?.textContent.trim() ?? ""`,
      frame,
    );
  };

  const column = (title: string) => {
    const { session, frame } = at();

    return session.evaluate<string[]>(
      `(() => {
        const at = [...document.querySelectorAll('${LIST} th')].map((each) => each.textContent.trim()).indexOf(${JSON.stringify(title)});
        return at < 0 ? [] : [...document.querySelectorAll(${JSON.stringify(ROWS)})].map((row) => row.children[at]?.textContent.trim() ?? "");
      })()`,
      frame,
    );
  };

  const openRow = async (name: string) => {
    const { session, frame } = at();

    await clickSidebar(session, frame, "mongodb-clusters", "mongodb");
    await waitFor("the clusters", async () =>
      (await countOf(session, frame, ROWS)) > 0 ? true : undefined,
    );
    // The second cell: the first holds the row's checkbox, which opens nothing.
    await session.evaluate(
      `[...document.querySelectorAll('${LIST} tbody tr')].find((row) => row.textContent.includes(${JSON.stringify(name)}))?.querySelector("td:nth-child(2)").click()`,
      frame,
    );
    await waitFor(`${name}'s drawer`, async () =>
      (await drawerTitle(session, frame, DRAWER)) === `Cluster: ${name}` &&
      (await countOf(session, frame, `${DRAWER} [data-section="mongodb-members"]`)) > 0
        ? true
        : undefined,
    );
  };

  return { where, activeChip, column, openRow };
};
