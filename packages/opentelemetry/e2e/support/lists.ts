import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  clusterItems,
  countOf,
  drawerTitle,
  pressChip,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";

export const LIST = '[data-section="opentelemetry-coverage"]';
export const ROWS = `${LIST} tbody tr`;
export const COLLECTORS = '[data-section="opentelemetry-collectors"]';
export const COLLECTOR_ROWS = `${COLLECTORS} tbody tr`;
export const DRAWER = ".OpenTelemetryObjectDrawer";
export const WORKLOAD_BODY = `${DRAWER} [data-section="opentelemetry-workload"]`;
export const COLLECTOR_BODY = `${DRAWER} [data-section="opentelemetry-collector"]`;
export const CHIPS = ".OpenTelemetry-filters .OpenTelemetry-filter";
export const SEARCH = ".OpenTelemetry-page__actions .OpenTelemetry-search";
export const AGENT = "opentelemetry-auto-instrumentation-python";
const TICKED = `${ROWS} .OpenTelemetry-table__check input:checked`;

const headsOf = (section: string) =>
  `[...document.querySelectorAll(${JSON.stringify(`${section} thead th`)})].map((each) => each.textContent.trim())`;

/** The row of `namespace/name` in a list, found by its Name and Namespace headers. */
export function rowNamed(section: string, key: string): string {
  const [namespace, name] = key.split("/");

  return `(() => {
    const heads = ${headsOf(section)};
    const cell = (row, title) => row.children[heads.indexOf(title)]?.textContent.trim();
    return [...document.querySelectorAll(${JSON.stringify(`${section} tbody tr`)})]
      .find((row) => cell(row, "Name") === ${JSON.stringify(name)} && cell(row, "Namespace") === ${JSON.stringify(namespace)});
  })()`;
}

/** The Status label in a row, without its reason; "" when the row is not shown. */
export function stateOf(session: Session, frame: number, section: string, key: string) {
  return session.evaluate<string>(
    `${rowNamed(section, key)}?.querySelector(".OpenTelemetry-status")?.textContent.trim() ?? ""`,
    frame,
  );
}

/** The reason beside a row's Status; "" when the row is not shown. */
export function reasonOf(session: Session, frame: number, section: string, key: string) {
  return session.evaluate<string>(
    `${rowNamed(section, key)}?.querySelector(".OpenTelemetry-truncate")?.getAttribute("title") ?? ""`,
    frame,
  );
}

/** The cells of one column, by its header, in the order shown. */
export function column(session: Session, frame: number, section: string, title: string) {
  return session.evaluate<string[]>(
    `(() => {
      const at = ${headsOf(section)}.indexOf(${JSON.stringify(title)});
      return at < 0 ? [] : [...document.querySelectorAll(${JSON.stringify(`${section} tbody tr`)})]
        .map((row) => row.children[at]?.textContent.trim() ?? "");
    })()`,
    frame,
  );
}

// A chip or a search left by an earlier test would narrow what the next one reads.
export async function openCoverage(session: Session, frame: number): Promise<number> {
  await clickSidebar(session, frame, "opentelemetry-coverage", "opentelemetry");
  await waitFor(
    "the Coverage chips",
    async () => (await countOf(session, frame, CHIPS)) > 0 || undefined,
  );

  const pressed = await session.evaluate<string>(
    `[...document.querySelectorAll(${JSON.stringify(CHIPS)})].find((each) => each.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? ""`,
    frame,
  );

  if (pressed !== "All") await pressChip(session, frame, CHIPS, "All");
  await typeInto(session, frame, SEARCH, "");

  const rows = await waitFor("the Coverage rows", async () => {
    const shown = await countOf(session, frame, ROWS);

    return shown > 0 ? shown : undefined;
  });

  // Rows read Checking until the operator's Deployment, Instrumentations and TLS names are read.
  await waitFor("every row checked", async () =>
    (await column(session, frame, LIST, "State")).some((cell) => cell.includes("Checking"))
      ? undefined
      : true,
  );

  const left = await countOf(session, frame, TICKED);

  if (left > 0 || (await countOf(session, frame, '[data-section="selection"]')) > 0) {
    throw new Error(`${left} Coverage rows were left ticked by an earlier test`);
  }

  return rows;
}

export async function openCollectors(session: Session, frame: number): Promise<number> {
  await clickSidebar(session, frame, "opentelemetry-collectors", "opentelemetry");
  await waitFor(
    "the Collectors list",
    async () => (await countOf(session, frame, COLLECTORS)) > 0 || undefined,
  );
  await typeInto(session, frame, SEARCH, "");

  return waitFor("the Collectors rows", async () => {
    const rows = await countOf(session, frame, COLLECTOR_ROWS);

    return rows > 0 ? rows : undefined;
  });
}

function untilDrawer(session: Session, frame: number, key: string, title: string, body: string) {
  return waitFor(`${key}'s drawer`, async () =>
    (await drawerTitle(session, frame, DRAWER)) === title &&
    (await countOf(session, frame, body)) > 0
      ? true
      : undefined,
  );
}

/** Clicks the row's Name cell, never its checkbox or menu, and waits for its drawer. */
export async function openWorkload(
  session: Session,
  frame: number,
  key: string,
  kind: string,
): Promise<void> {
  await openCoverage(session, frame);
  await clickName(session, frame, LIST, key);
  await untilDrawer(session, frame, key, `${kind}: ${key.split("/")[1]}`, WORKLOAD_BODY);
}

export async function openCollector(session: Session, frame: number, key: string): Promise<void> {
  await openCollectors(session, frame);
  await clickName(session, frame, COLLECTORS, key);
  await untilDrawer(
    session,
    frame,
    key,
    `OpenTelemetryCollector: ${key.split("/")[1]}`,
    COLLECTOR_BODY,
  );
}

function cellOf(section: string, key: string, title: string): string {
  return `${rowNamed(section, key)}?.children[${headsOf(section)}.indexOf(${JSON.stringify(title)})]`;
}

async function clickName(session: Session, frame: number, section: string, key: string) {
  const clicked = await session.evaluate<boolean>(
    `(() => {
      const cell = ${cellOf(section, key, "Name")};
      cell?.click();
      return Boolean(cell);
    })()`,
    frame,
  );

  if (!clicked) throw new Error(`no row for ${key} in ${section}`);
}

/** Ticks or unticks a Coverage row through the host's Checkbox in its first cell. */
export async function tick(session: Session, frame: number, key: string): Promise<void> {
  const ticked = await session.evaluate<boolean>(
    `(() => {
      const box = ${rowNamed(LIST, key)}?.querySelector(".OpenTelemetry-table__check input");
      box?.click();
      return Boolean(box);
    })()`,
    frame,
  );

  if (!ticked) throw new Error(`no checkbox for ${key}`);
}

// biome-ignore lint/suspicious/noExplicitAny: pods are read loosely here.
export type Pod = Record<string, any>;

export function appPodsOf(session: Session, frame: number, key: string): Promise<Pod[]> {
  const [namespace, app] = key.split("/");

  return clusterItems<Pod>(
    session,
    frame,
    `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(`app=${app}`)}`,
  );
}

export const hasAgent = (pod: Pod): boolean =>
  (pod.spec?.initContainers ?? []).some((each: { name: string }) => each.name === AGENT);
