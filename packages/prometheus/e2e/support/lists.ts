import type { Session } from "../../../../build/e2e/cdp";
import {
  clickSidebar,
  countOf,
  drawerTitle,
  typeInto,
  waitFor,
} from "../../../../build/e2e/freelens";

export const GROUP = "prometheus";
export const USAGE_GROUP = ["prometheus", "prometheus-usage"];

export const MONITORS = '[data-section="prometheus-monitors"]';
export const RULES = '[data-section="prometheus-rules"]';
export const INSTANCES = '[data-section="prometheus-instances"]';
export const NODES = '[data-section="prometheus-usage-nodes"]';
export const PODS = '[data-section="prometheus-usage-pods"]';
export const NODE_CHARTS = '[data-section="prometheus-usage-node-charts"]';
export const POD_CHART = '[data-section="prometheus-usage-pod-chart"]';
export const rowsOf = (section: string) => `${section} tbody tr`;

export const DRAWER = ".PrometheusObjectDrawer";
export const SEARCH = ".Prometheus-page__actions .Prometheus-search";
export const NOTICE = '[data-section="prometheus-usage-notice"]';
export const CLUSTERS_NOTICE = '[data-section="prometheus-usage-clusters"]';
export const WINDOW = '[data-section="prometheus-usage-window"]';
export const RANGE_LABEL = '[data-section="prometheus-usage-range-label"]';
export const RANGE_DIALOG = '[data-section="prometheus-usage-range"]';
export const NODE_FILTER = '[data-section="prometheus-usage-node-filter"]';
export const POD_FILTER = '[data-section="prometheus-usage-pod-filter"]';

export interface List {
  page: string;
  section: string;
  /** The chips' `data-section`; none on the Usage pages. */
  chips?: string;
  group: string | string[];
}

export const LISTS = {
  monitors: {
    page: "prometheus-monitors",
    section: MONITORS,
    chips: '[data-section="prometheus-monitor-filters"] .Prometheus-filter',
    group: GROUP,
  },
  rules: {
    page: "prometheus-rules",
    section: RULES,
    chips: '[data-section="prometheus-rule-filters"] .Prometheus-filter',
    group: GROUP,
  },
  instances: {
    page: "prometheus-instances",
    section: INSTANCES,
    chips: '[data-section="prometheus-instance-filters"] .Prometheus-filter',
    group: GROUP,
  },
  nodes: { page: "prometheus-usage-nodes", section: NODES, group: USAGE_GROUP },
  pods: { page: "prometheus-usage-pods", section: PODS, group: USAGE_GROUP },
} satisfies Record<string, List>;

/** A chip's label, without the count beside it. */
export const chipLabel = (chip: string) =>
  `[...${chip}.childNodes].filter((each) => each.nodeType === Node.TEXT_NODE).map((each) => each.textContent).join("").trim()`;

export function activeChip(session: Session, frame: number, chips: string): Promise<string> {
  return session.evaluate<string>(
    `(() => {
      const chip = [...document.querySelectorAll(${JSON.stringify(chips)})]
        .find((each) => each.getAttribute("aria-pressed") === "true");
      return chip ? ${chipLabel("chip")} : "";
    })()`,
    frame,
  );
}

export async function pressChip(
  session: Session,
  frame: number,
  chips: string,
  label: string,
): Promise<void> {
  const pressed = await session.evaluate<boolean>(
    `(() => {
      const chip = [...document.querySelectorAll(${JSON.stringify(chips)})]
        .find((each) => ${chipLabel("each")} === ${JSON.stringify(label)});
      chip?.click();
      return Boolean(chip);
    })()`,
    frame,
  );

  if (!pressed) throw new Error(`no chip labelled ${label}`);

  await waitFor(`${label} pressed`, async () =>
    (await activeChip(session, frame, chips)) === label ? true : undefined,
  );
}

/**
 * Waits for the page's live reads and Events to land: they change states, counts and order.
 * `within` names something of this page, so the page being left does not answer.
 */
export function untilLive(session: Session, frame: number, within: string): Promise<true> {
  return waitFor(
    "the live reads",
    async () =>
      (await countOf(session, frame, `.Prometheus-page[data-live="read"] ${within}`)) > 0 ||
      undefined,
    90_000,
  );
}

const headsOf = (section: string) =>
  `[...document.querySelectorAll(${JSON.stringify(`${section} thead th`)})].map((each) => each.textContent.trim())`;

/** The row with this Name, and this Namespace and Kind where the list has those columns. */
export function rowNamed(section: string, key: string, kind?: string): string {
  const parts = key.split("/");
  const name = parts.at(-1) ?? "";
  const namespace = parts.length > 1 ? parts[0] : undefined;

  return `(() => {
    const heads = ${headsOf(section)};
    const cell = (row, title) => row.children[heads.indexOf(title)]?.textContent.trim();
    const namespace = ${JSON.stringify(namespace ?? null)};
    const kind = ${JSON.stringify(kind ?? null)};
    return [...document.querySelectorAll(${JSON.stringify(rowsOf(section))})]
      .find((row) => cell(row, "Name") === ${JSON.stringify(name)}
        && (namespace === null || cell(row, "Namespace") === namespace)
        && (kind === null || cell(row, "Kind") === kind));
  })()`;
}

/** The Status label in a row, without its reason; "" when the row is not shown. */
export function stateOf(
  session: Session,
  frame: number,
  section: string,
  key: string,
  kind?: string,
): Promise<string> {
  return session.evaluate<string>(
    `${rowNamed(section, key, kind)}?.querySelector(".Prometheus-status")?.textContent.trim() ?? ""`,
    frame,
  );
}

/** Waits for the row to show this state: the live read and the Events come after the list. */
export function untilState(
  session: Session,
  frame: number,
  section: string,
  key: string,
  state: string,
  kind?: string,
): Promise<string> {
  return waitFor(
    `${key} to read ${state}`,
    async () => {
      const shown = await stateOf(session, frame, section, key, kind);

      return shown === state ? shown : undefined;
    },
    90_000,
  ).catch(async (error) => {
    const shown = await stateOf(session, frame, section, key, kind);

    throw new Error(`${key} reads "${shown}", not "${state}" (${error})`);
  });
}

export function column(
  session: Session,
  frame: number,
  section: string,
  title: string,
): Promise<string[]> {
  return session.evaluate<string[]>(
    `(() => {
      const at = ${headsOf(section)}.indexOf(${JSON.stringify(title)});
      return at < 0 ? [] : [...document.querySelectorAll(${JSON.stringify(rowsOf(section))})]
        .map((row) => row.children[at]?.textContent.trim() ?? "");
    })()`,
    frame,
  );
}

/** The cell of one row under a header; "" when either is not shown. */
export function cellOf(
  session: Session,
  frame: number,
  section: string,
  key: string,
  title: string,
  kind?: string,
): Promise<string> {
  return session.evaluate<string>(
    `(() => {
      const heads = ${headsOf(section)};
      return ${rowNamed(section, key, kind)}?.children[heads.indexOf(${JSON.stringify(title)})]?.textContent.trim() ?? "";
    })()`,
    frame,
  );
}

// A chip or a search left by an earlier test would narrow what the next one reads.
export async function openList(session: Session, frame: number, list: List): Promise<number> {
  await clickSidebar(session, frame, list.page, list.group);
  await waitFor(
    `the ${list.page} page`,
    async () => (await countOf(session, frame, SEARCH)) > 0 || undefined,
  );

  if (list.chips) {
    await waitFor(
      `the ${list.page} chips`,
      async () => (await countOf(session, frame, list.chips ?? "")) > 0 || undefined,
    );
    if ((await activeChip(session, frame, list.chips)) !== "All") {
      await pressChip(session, frame, list.chips, "All");
    }
  }
  await typeInto(session, frame, SEARCH, "");

  return waitFor(`the ${list.page} rows`, async () => {
    const shown = await countOf(session, frame, rowsOf(list.section));

    return shown > 0 ? shown : undefined;
  });
}

/** Clicks the row's Name cell, never its menu, and waits for its drawer. */
export async function openRow(
  session: Session,
  frame: number,
  list: List,
  key: string,
  title: string,
  body: string,
  kind?: string,
): Promise<void> {
  await openList(session, frame, list);

  await waitFor(`${key}'s row`, () =>
    session.evaluate<boolean>(
      `(() => {
        const heads = ${headsOf(list.section)};
        const cell = ${rowNamed(list.section, key, kind)}?.children[heads.indexOf("Name")];
        cell?.click();
        return Boolean(cell);
      })()`,
      frame,
    ),
  );
  await waitFor(`${key}'s drawer`, async () =>
    (await drawerTitle(session, frame, DRAWER)) === title &&
    (await countOf(session, frame, `${DRAWER} ${body}`)) > 0
      ? true
      : undefined,
  );
}

export function drawerTerms(session: Session, frame: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll('${DRAWER} .Prometheus-facts dt')].map((each) => each.textContent.trim())`,
    frame,
  );
}

/** What a filter shows: a window's value, or a choice filter's placeholder. */
export function filterText(session: Session, frame: number, filter: string): Promise<string> {
  return session.evaluate<string>(
    `(document.querySelector(${JSON.stringify(`${filter} [class*="Select__single-value"], ${filter} [class*="Select__placeholder"]`)})?.textContent ?? "").trim()`,
    frame,
  );
}

/**
 * As selectNamespace, scoped to one filter. react-select names options react-select-<id>-option-<n>.
 * Waits for the filter to show `shows`, the option by default; false waits for nothing.
 */
export async function chooseInFilter(
  session: Session,
  frame: number,
  filter: string,
  option: string,
  shows: string | false = option,
): Promise<void> {
  const outcome = await session.evaluate<string>(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fire = (element) => {
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      };
      const control = document.querySelector(${JSON.stringify(`${filter} [class*="Select__control"]`)});
      if (!control) return "no such filter";
      const id = control.querySelector("input")?.id;

      fire(control);

      for (let attempt = 0; attempt < 25; attempt++) {
        const wanted = [...document.querySelectorAll('[id*="-' + id + '-option-"]')]
          .find((each) => ((each.querySelector(".Prometheus-usage__option")?.firstChild ?? each).textContent ?? "").trim() === ${JSON.stringify(option)});

        if (wanted) {
          fire(wanted);
          document.activeElement?.blur();
          return "chosen";
        }

        await wait(200);
      }

      return "no such option";
    })()`,
    frame,
  );

  if (outcome !== "chosen") throw new Error(`could not choose ${option}: ${outcome}`);
  if (shows === false) return;

  await waitFor(`${filter} to show ${shows}`, async () =>
    (await filterText(session, frame, filter)) === shows ? true : undefined,
  ).catch(async (error) => {
    throw new Error(`${filter} shows "${await filterText(session, frame, filter)}" (${error})`);
  });
}

export function filterSays(session: Session, frame: number, filter: string): Promise<string> {
  return session.evaluate<string>(
    `(document.querySelector(${JSON.stringify(`${filter} [class*="Select__placeholder"]`)})?.textContent ?? "").trim()`,
    frame,
  );
}

export function windowSays(session: Session, frame: number): Promise<string> {
  return session.evaluate<string>(
    `(document.querySelector(${JSON.stringify(`${WINDOW} [class*="Select__single-value"]`)})?.textContent ?? "").trim()`,
    frame,
  );
}
