import { type ExecutionContext, listTargets, Session } from "./cdp";

const DEBUG_PORT = Number(process.env.FREELENS_DEBUG_PORT ?? 9222);

const CLUSTER_ORIGIN = /^https:\/\/[0-9a-f]+\.renderer\.freelens\.app/;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  what: string,
  attempt: () => Promise<T | undefined | null | false>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await attempt();

      if (value !== undefined && value !== null && value !== false) return value;
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError}` : ""}`);
}

export interface ConsoleError {
  source: "console" | "exception";
  text: string;
}

export interface ErrorLog {
  drain(): ConsoleError[];
}

export interface Workbench {
  session: Session;
  frame: number;
  errors: ErrorLog;
}

interface StackTrace {
  callFrames: { url: string }[];
}

// Leaving the cluster view (a reload, or the catalog) makes the host's main frame throw "illegal access" as it unmounts.
const leaving = new WeakMap<Session, number>();
const MAIN_FRAME_SCRIPT = /^https:\/\/renderer\.freelens\.app[:/]/;

async function whileLeaving<T>(session: Session, run: () => Promise<T>): Promise<T> {
  leaving.set(session, (leaving.get(session) ?? 0) + 1);

  try {
    return await run();
  } finally {
    leaving.set(session, (leaving.get(session) ?? 1) - 1);
  }
}

export function collectErrors(session: Session): ErrorLog {
  const seen: ConsoleError[] = [];
  const reloadNoise = (url = "") => (leaving.get(session) ?? 0) > 0 && MAIN_FRAME_SCRIPT.test(url);

  session.on<{
    type: string;
    args: { value?: unknown; description?: string }[];
    stackTrace?: StackTrace;
  }>("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error" || reloadNoise(params.stackTrace?.callFrames[0]?.url)) return;

    const text = params.args
      .map((arg) => String(arg.description ?? arg.value ?? ""))
      .join(" ")
      .trim();

    if (text) seen.push({ source: "console", text });
  });

  session.on<{
    exceptionDetails: {
      text: string;
      url?: string;
      exception?: { description?: string; value?: unknown };
    };
  }>("Runtime.exceptionThrown", (params) => {
    const { exception, text, url } = params.exceptionDetails;

    if (reloadNoise(url)) return;

    seen.push({
      source: "exception",
      text:
        exception?.description ??
        (exception?.value === undefined ? text : `${text} ${String(exception.value)}`),
    });
  });

  return {
    drain: () => seen.splice(0, seen.length),
  };
}

export async function connect(): Promise<Session> {
  const target = await waitFor("the Freelens window", async () => {
    const targets = await listTargets(DEBUG_PORT);

    return targets.find((each) => each.type === "page" && each.url.includes("freelens.app"));
  });

  const session = await Session.open(target.webSocketDebuggerUrl);

  await session.send("Runtime.enable");
  await session.send("Page.enable");

  return session;
}

// Re-enabling Runtime replays one creation event per live context; CDP has no call that lists them.
async function liveExecutionContexts(session: Session): Promise<ExecutionContext[]> {
  const found = new Map<number, ExecutionContext>();

  session.on<{ context: ExecutionContext }>("Runtime.executionContextCreated", (params) =>
    found.set(params.context.id, params.context),
  );
  session.on<{ executionContextId: number }>("Runtime.executionContextDestroyed", (params) =>
    found.delete(params.executionContextId),
  );

  await session.send("Runtime.disable");
  await session.send("Runtime.enable");
  await sleep(400);

  return [...found.values()];
}

// A reload creates the new context before the old one is reported destroyed.
export async function clusterFrame(session: Session): Promise<number> {
  return waitFor("the cluster frame", async () => {
    const candidates = (await liveExecutionContexts(session))
      .filter((context) => CLUSTER_ORIGIN.test(context.origin))
      .sort((a, b) => b.id - a.id);

    for (const candidate of candidates) {
      try {
        if (await session.evaluate<boolean>("!!document.body", candidate.id)) return candidate.id;
      } catch {
        // replaced since it was listed
      }
    }

    return undefined;
  });
}

export async function openCluster(session: Session): Promise<void> {
  await whileLeaving(session, async () => {
    await session.evaluate("location.pathname = '/catalog'");
    await sleep(1500);
  });

  // A fresh Freelens opens the catalog on another kind: wait for the clusters tab first.
  await waitFor("the catalog's clusters tab", async () =>
    session.evaluate<boolean>(
      "(() => { const tab = document.querySelector(" +
        `'[data-testid="entity.k8slens.dev/KubernetesCluster-tab"]');` +
        " if (!tab) return false; if (tab.className.includes('selected')) return true;" +
        " tab.click(); return false; })()",
    ),
  );

  await waitFor("the cluster to open", async () =>
    session.evaluate<boolean>(
      "(() => { if (location.pathname.startsWith('/cluster/')) return true;" +
        " const row = document.querySelector('[class*=TableRow]');" +
        " row?.dispatchEvent(new MouseEvent('click', {bubbles: true})); return false; })()",
    ),
  );
}

/** Reloads the cluster frame so a suite inherits no stores, namespace scope or loaded list. */
export async function freshClusterFrame(session: Session): Promise<number> {
  const frame = await whileLeaving(session, async () => {
    await openCluster(session);

    const stale = await clusterFrame(session);

    // Deferred, so the evaluation answers before its context goes away.
    await session.evaluate("setTimeout(() => location.reload(), 0)", stale);

    return waitFor("the reloaded cluster frame", async () => {
      const next = await clusterFrame(session);

      return next > stale ? next : undefined;
    });
  });

  await assertDevCluster(session, frame);

  return frame;
}

export async function sidebarItems(session: Session, contextId: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll('[data-testid^="sidebar-item-"]')]` +
      `.map((each) => each.getAttribute("data-testid").replace("sidebar-item-", ""))`,
    contextId,
  );
}

function sidebarSelector(prefix: string, id: string): string {
  return JSON.stringify(`[data-testid^="${prefix}-for-sidebar-item-"][data-testid$="-${id}"]`);
}

// The icon toggles and Freelens persists open groups, so click only while collapsed.
async function expandGroup(session: Session, contextId: number, groupId: string): Promise<void> {
  await session.evaluate(
    `(() => {
      const icon = document.querySelector(${sidebarSelector("expand-icon", groupId)});
      if (icon?.querySelector('[data-icon-name="keyboard_arrow_down"]')) icon.click();
    })()`,
    contextId,
  );
}

// Groups are listed outermost first; expanding runs on every pass: the sidebar renders after the context exists.
export async function clickSidebar(
  session: Session,
  contextId: number,
  pageId: string,
  groupId?: string | string[],
): Promise<void> {
  const clickPage = () =>
    session.evaluate<boolean>(
      `(() => {
        const link = document.querySelector(${sidebarSelector("link", pageId)});
        if (!link) return false;
        link.click();
        return true;
      })()`,
      contextId,
    );

  await waitFor(
    `the sidebar entry "${pageId}"`,
    async () => {
      if (await clickPage()) return true;

      for (const group of [groupId ?? []].flat()) await expandGroup(session, contextId, group);

      return undefined;
    },
    30_000,
  ).catch(async () => {
    const items = await sidebarItems(session, contextId);

    throw new Error(`no sidebar entry with id "${pageId}". Sidebar shows: ${items.join(" | ")}`);
  });

  await sleep(1200);
}

export async function selectAllNamespaces(session: Session, contextId: number): Promise<void> {
  await pickNamespaceOption(
    session,
    contextId,
    "All Namespaces",
    "the namespace menu never opened",
    "could not widen the namespace scope",
    false,
  );
}

export async function selectNamespace(
  session: Session,
  contextId: number,
  namespace: string,
): Promise<void> {
  await pickNamespaceOption(
    session,
    contextId,
    namespace,
    "no option for that namespace",
    `could not scope to ${namespace}`,
    true,
  );
}

// Needs a KubeObjectListLayout page. react-select's menu closes on a protocol round-trip, so the pick runs in one page-side routine.
async function pickNamespaceOption(
  session: Session,
  contextId: number,
  optionLabel: string,
  missing: string,
  failure: string,
  stripIcons: boolean,
): Promise<void> {
  // A page renders its selector only once its lists have landed.
  const ready = await waitFor(
    "the namespace select",
    () =>
      session.evaluate<boolean>(
        `Boolean(document.querySelector('[class*="Select__control"]'))`,
        contextId,
      ),
    30_000,
  ).catch(() => false);

  if (!ready) throw new Error(`${failure}: no namespace select on this page`);

  const outcome = await session.evaluate<string>(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fire = (element) => {
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      };
      // An option's text includes the layers and check icon ligatures.
      const named = (option) => ${stripIcons}
        ? option.textContent.replace("layers", "").replace("check", "").trim()
        : option.textContent.trim();

      const control = document.querySelector('[class*="Select__control"]');
      if (!control) return "no namespace select on this page";

      fire(control);

      for (let attempt = 0; attempt < 25; attempt++) {
        const wanted = [...document.querySelectorAll('[id*="option"]')]
          .find((option) => named(option) === ${JSON.stringify(optionLabel)});

        if (wanted) { fire(wanted); return "selected"; }

        await wait(200);
      }

      return ${JSON.stringify(missing)};
    })()`,
    contextId,
  );

  if (outcome !== "selected") throw new Error(`${failure}: ${outcome}`);

  await sleep(2500);
}

export const DEV_NODE = "freelens-addons-dev";

/** The suites click buttons that write: never drive a window opened on another cluster. */
export async function assertDevCluster(session: Session, contextId: number): Promise<void> {
  const nodes = await session.evaluate<string[]>(
    `fetch("/api-kube/api/v1/nodes").then((response) => response.json()).then((list) => (list.items ?? []).map((node) => node.metadata.name))`,
    contextId,
  );

  if (nodes.length !== 1 || nodes[0] !== DEV_NODE) {
    throw new Error(
      `refusing: Freelens has a cluster open that is not the dev k3s (its only node is ${DEV_NODE}; found: ${nodes.join(", ") || "none"})`,
    );
  }
}

export async function openDevCluster(session: Session): Promise<number> {
  await openCluster(session);

  const frame = await clusterFrame(session);

  await assertDevCluster(session, frame);

  return frame;
}

// A host list page: the namespace control lives there.
async function widenToAllNamespaces(session: Session, frame: number): Promise<void> {
  await clickSidebar(session, frame, "pods", "workloads");
  await selectAllNamespaces(session, frame);
}

export async function openWorkbench(): Promise<Workbench> {
  const session = await connect();
  const errors = collectErrors(session);
  const openedFrame = await openDevCluster(session);

  await widenToAllNamespaces(session, openedFrame);

  const frame = await clusterFrame(session);

  return { session, frame, errors };
}

function queryOrThrow(selector: string): string {
  return `const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('nothing matching ' + ${JSON.stringify(selector)});`;
}

// Tooltips open on a pointer sequence, not a bare `mouseover`. "" means none appeared.
export async function hoverForTooltip(
  session: Session,
  contextId: number,
  selector: string,
): Promise<string> {
  return session.evaluate<string>(
    `(async () => {
      ${queryOrThrow(selector)}

      for (const type of ["pointerenter", "pointerover", "mouseenter", "mouseover", "mousemove"]) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const tooltip = [...document.querySelectorAll('[class*="Tooltip"]')]
        .find((each) => each.className.includes("visible"));

      return tooltip ? tooltip.textContent.trim() : "";
    })()`,
    contextId,
  );
}

export async function computedStyle(
  session: Session,
  contextId: number,
  selector: string,
  property: string,
): Promise<string> {
  return session.evaluate<string>(
    `(() => {
      ${queryOrThrow(selector)}
      return getComputedStyle(element).getPropertyValue(${JSON.stringify(property)}).trim();
    })()`,
    contextId,
  );
}

// Resolved through a probe element, so it compares with a computed `rgb(...)`.
export async function resolvedThemeColor(
  session: Session,
  contextId: number,
  variable: string,
): Promise<string> {
  return session.evaluate<string>(
    `(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(${variable})";
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    })()`,
    contextId,
  );
}

export async function overflowsSideways(
  session: Session,
  contextId: number,
  selector: string,
): Promise<number> {
  return session.evaluate<number>(
    `(() => {
      ${queryOrThrow(selector)}
      return element.scrollWidth - element.clientWidth;
    })()`,
    contextId,
  );
}

export async function proxyFetch(
  session: Session,
  contextId: number,
  apiPath: string,
  init?: { method: string; contentType: string; body?: string },
): Promise<{ status: number; body: string }> {
  const url = JSON.stringify(`/api-kube${apiPath}`);
  const options = init
    ? `, {
      method: ${JSON.stringify(init.method)},
      headers: { "Content-Type": ${JSON.stringify(init.contentType)} },
      body: ${init.body === undefined ? "undefined" : JSON.stringify(init.body)},
    }`
    : "";

  return session.evaluate<{ status: number; body: string }>(
    `fetch(${url}${options}).then(async (response) => ({ status: response.status, body: await response.text() }))`,
    contextId,
  );
}

export async function clusterItems<Item = Record<string, unknown>>(
  session: Session,
  contextId: number,
  apiPath: string,
): Promise<Item[]> {
  const { body } = await proxyFetch(session, contextId, apiPath);

  const parsed = JSON.parse(body) as { items?: Item[] };

  if (!Array.isArray(parsed.items)) {
    throw new Error(`${apiPath} did not answer with a list: ${body.slice(0, 200)}`);
  }

  return parsed.items;
}

function clickIfShown(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
): Promise<boolean> {
  return session.evaluate<boolean>(
    `(() => {
      const found = ${firstWithText(selector, text)};
      if (!found) return false;
      found.click();
      return true;
    })()`,
    contextId,
  );
}

function firstWithText(selector: string, text: string): string {
  return `[...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => each.textContent.includes(${JSON.stringify(text)}))`;
}

export async function clickWhenShown(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitFor(
    `a ${selector} containing ${JSON.stringify(text)}`,
    async () => clickIfShown(session, contextId, selector, text),
    timeoutMs,
  );
}

/** Clicks until a dialog opens and returns its text: a list that learns of a write late refuses until then. */
export function clickUntilDialog(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
  timeoutMs = 60_000,
): Promise<string> {
  return waitFor(
    `a dialog from ${JSON.stringify(text)}`,
    async () => {
      await clickWhenShown(session, contextId, selector, text);

      // Throws when none opens, so the outer wait clicks again.
      return waitFor(
        "the dialog",
        async () =>
          (await session.evaluate<string>(
            "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
            contextId,
          )) || undefined,
        3_000,
      );
    },
    timeoutMs,
  );
}

/** Clicks a chip and waits until it shows pressed: what it filters renders in that same pass. */
export async function pressChip(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
): Promise<void> {
  await clickWhenShown(session, contextId, selector, text);
  await waitFor(`${JSON.stringify(text)} to show pressed`, async () =>
    session.evaluate<boolean>(
      `${firstWithText(selector, text)}?.getAttribute("aria-pressed") === "true"`,
      contextId,
    ),
  );
}

/** Clicks a header's sort and waits until its aria-sort changes: the rows reorder in that same pass. */
export async function pressSort(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
): Promise<void> {
  const sortOf = () =>
    session.evaluate<string>(
      `${firstWithText(selector, text)}?.closest("th")?.getAttribute("aria-sort") ?? ""`,
      contextId,
    );
  const before = await sortOf();

  await clickWhenShown(session, contextId, selector, text);
  await waitFor(`${JSON.stringify(text)} to sort`, async () => (await sortOf()) !== before);
}

/** Clicks `icon` when given, then waits for its menu: it renders a moment after the click. */
export async function openMenu(session: Session, contextId: number, icon?: string): Promise<void> {
  if (icon) {
    const clicked = await session.evaluate<boolean>(
      `(() => { const icon = document.querySelector(${JSON.stringify(icon)}); icon?.click(); return Boolean(icon); })()`,
      contextId,
    );

    if (!clicked) throw new Error(`no menu icon matching ${icon}`);
  }

  await waitFor(
    "the menu to open",
    async () =>
      (await session.evaluate<number>("document.querySelectorAll('.MenuItem').length", contextId)) >
      0,
  );
}

export function clickMenuItem(session: Session, contextId: number, title: string): Promise<void> {
  return clickWhenShown(session, contextId, ".MenuItem", title);
}

// Newest last.
export function notifications(session: Session, contextId: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll('[class*="notification"]')].map((each) => each.textContent.trim())`,
    contextId,
  );
}

// Notifications stack, so the first one may be a previous action's.
export function notificationSaying(
  session: Session,
  contextId: number,
  text: string,
): Promise<string> {
  return waitFor(`a notification saying ${JSON.stringify(text)}`, async () =>
    (await notifications(session, contextId)).find((each) => each.includes(text)),
  );
}

export async function notificationText(session: Session, contextId: number): Promise<string> {
  return waitFor("a notification", async () => {
    const text = await session.evaluate<string>(
      `(() => {
        const note = document.querySelector('[class*="notification"]');
        return note ? note.textContent.trim() : "";
      })()`,
      contextId,
    );

    return text.length > 0 ? text : undefined;
  });
}

// Setting `.value` does not reach a React controlled input; the native setter does.
export async function typeInto(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
): Promise<void> {
  await session.evaluate(
    `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) throw new Error('no field matching ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(field, ${JSON.stringify(text)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
    contextId,
  );
}

export async function textOf(
  session: Session,
  contextId: number,
  selector: string,
): Promise<string> {
  return session.evaluate<string>(
    `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`,
    contextId,
  );
}

/** The drawer on screen: one closing stays in the DOM, without its body, until it animates out. */
export function shownDrawer(drawer: string): string {
  return `[...document.querySelectorAll(${JSON.stringify(drawer)})].filter((each) => each.querySelector("[data-section]")).at(-1)`;
}

/** Without the copy icon the host puts in the title. */
export function drawerTitle(session: Session, contextId: number, drawer: string): Promise<string> {
  return session.evaluate<string>(
    `[...(${shownDrawer(drawer)}?.querySelector(".drawer-title-text")?.childNodes ?? [])]
       .filter((each) => each.nodeType === Node.TEXT_NODE).map((each) => each.textContent).join("").trim()`,
    contextId,
  );
}

export function waitForNoDialog(
  session: Session,
  contextId: number,
  what: string,
  timeoutMs?: number,
): Promise<boolean> {
  return waitFor(
    what,
    async () =>
      (await session.evaluate<number>(
        "document.querySelectorAll('.ConfirmDialog').length",
        contextId,
      )) === 0,
    timeoutMs,
  );
}

export function countOf(session: Session, contextId: number, selector: string): Promise<number> {
  return session.evaluate<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    contextId,
  );
}

export function dialogText(session: Session, contextId: number): Promise<string> {
  return waitFor("the confirmation", async () => {
    const text = await session.evaluate<string>(
      "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
      contextId,
    );

    return text || undefined;
  });
}

export async function cancelDialog(session: Session, contextId: number): Promise<void> {
  await clickWhenShown(session, contextId, ".ConfirmDialog button", "Cancel");
  await waitForNoDialog(session, contextId, "the dialog to close");
}

/** Cancels any dialog and opens that page, so an afterEach leaves no ticks or dialog behind. */
export async function leaveNothingBehind(
  session: Session,
  contextId: number,
  pageId: string,
  groupId?: string | string[],
): Promise<void> {
  try {
    await session.evaluate(
      `[...document.querySelectorAll(".ConfirmDialog button")].find((each) => each.textContent.trim() === "Cancel")?.click()`,
      contextId,
    );
    await waitForNoDialog(session, contextId, "no dialog left open", 10_000);
    await clickSidebar(session, contextId, pageId, groupId);
  } catch (error) {
    console.log(`  could not tidy up after the test: ${error}`);
  }
}
