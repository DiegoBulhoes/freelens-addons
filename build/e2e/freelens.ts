import { type ExecutionContext, listTargets, Session } from "./cdp";

/**
 * Driving Freelens rather than a browser.
 *
 * Two things here are not ordinary page automation. The cluster's pages live in
 * an iframe of a different origin, reachable only through its execution
 * context, and that context is replaced whenever the frame reloads — so it is
 * looked up again rather than held.
 */

export const DEBUG_PORT = Number(process.env.FREELENS_DEBUG_PORT ?? 9222);

const CLUSTER_ORIGIN = /^https:\/\/[0-9a-f]+\.renderer\.freelens\.app/;

export async function waitFor<T>(
  what: string,
  attempt: () => Promise<T | undefined>,
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

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError}` : ""}`);
}

export interface ConsoleError {
  source: "console" | "exception";
  text: string;
}

/**
 * Errors the window reports while a test drives it.
 *
 * Borrowed from how Freelens tests its own example extension: it fails a run
 * when anything errors in the console, which catches a runtime fault no
 * assertion would have thought to look for. A page can render, answer every
 * query, and still be throwing on each keystroke.
 */
export function collectErrors(session: Session): { drain: () => ConsoleError[] } {
  const seen: ConsoleError[] = [];

  session.on<{ type: string; args: { value?: unknown; description?: string }[] }>(
    "Runtime.consoleAPICalled",
    (params) => {
      if (params.type !== "error") return;

      const text = params.args
        .map((arg) => String(arg.description ?? arg.value ?? ""))
        .join(" ")
        .trim();

      if (text) seen.push({ source: "console", text });
    },
  );

  session.on<{ exceptionDetails: { text: string; exception?: { description?: string } } }>(
    "Runtime.exceptionThrown",
    (params) => {
      seen.push({
        source: "exception",
        text: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text,
      });
    },
  );

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

/**
 * Every live context the page has now, looked up rather than cached.
 *
 * A frame's context is replaced when it navigates or reloads, and the replaced
 * one stops answering: evaluating in it fails with "Cannot find context with
 * specified id". Re-enabling replays a creation event for each live context,
 * which is the only way to enumerate them — the protocol has no "list contexts"
 * call — and the destroyed listener covers one going away mid-lookup.
 */
async function contexts(session: Session): Promise<ExecutionContext[]> {
  const found = new Map<number, ExecutionContext>();

  session.on<{ context: ExecutionContext }>("Runtime.executionContextCreated", (params) =>
    found.set(params.context.id, params.context),
  );
  session.on<{ executionContextId: number }>("Runtime.executionContextDestroyed", (params) =>
    found.delete(params.executionContextId),
  );

  await session.send("Runtime.disable");
  await session.send("Runtime.enable");
  await new Promise((resolve) => setTimeout(resolve, 400));

  return [...found.values()];
}

/**
 * The context of the cluster frame, where an extension's pages render.
 *
 * Newest first, and only returned once it has answered. A reload creates the new
 * context before the old one is reported destroyed, so the obvious choice — the
 * first match — is the one about to stop working, and every later call in the
 * test fails somewhere unrelated to what it was checking.
 */
export async function clusterFrame(session: Session): Promise<number> {
  return waitFor("the cluster frame", async () => {
    const candidates = (await contexts(session))
      .filter((context) => CLUSTER_ORIGIN.test(context.origin))
      .sort((a, b) => b.id - a.id);

    for (const candidate of candidates) {
      try {
        if (await session.evaluate<boolean>("!!document.body", candidate.id)) return candidate.id;
      } catch {
        // Replaced between being listed and being used. Try the next one.
      }
    }

    return undefined;
  });
}

export async function openCluster(session: Session): Promise<void> {
  await session.evaluate("location.pathname = '/catalog'");
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await waitFor("a cluster in the catalog", async () =>
    session.evaluate<boolean>(
      "(() => { const row = [...document.querySelectorAll('[class*=TableRow]')][0];" +
        " if (!row) return false; row.dispatchEvent(new MouseEvent('click', {bubbles: true}));" +
        " return true; })()",
    ),
  );

  await waitFor("the cluster to open", async () =>
    session.evaluate<boolean>("location.pathname.startsWith('/cluster/')"),
  );
}

/** Every sidebar item the frame currently shows, by id, for error messages. */
export async function sidebarItems(session: Session, contextId: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll('[data-testid^="sidebar-item-"]')]` +
      `.map((each) => each.getAttribute("data-testid").replace("sidebar-item-", ""))`,
    contextId,
  );
}

/** A selector matching one sidebar element by the id its page registered. */
function sidebarSelector(prefix: string, id: string): string {
  return JSON.stringify(`[data-testid^="${prefix}-for-sidebar-item-"][data-testid$="-${id}"]`);
}

/**
 * Opens a sidebar group, and does nothing if it is open already.
 *
 * The expand icon toggles, so clicking it unconditionally closes a group that
 * was expanded — and Freelens remembers which groups are open, in the state
 * volume, across restarts. The icon names its own state: `keyboard_arrow_down`
 * while collapsed, `keyboard_arrow_up` once open.
 */
async function expandGroup(session: Session, contextId: number, groupId: string): Promise<void> {
  await session.evaluate(
    `(() => {
      const icon = document.querySelector(${sidebarSelector("expand-icon", groupId)});
      if (icon?.querySelector('[data-icon-name="keyboard_arrow_down"]')) icon.click();
    })()`,
    contextId,
  );
}

/**
 * Clicks a sidebar entry by the page id the extension registered for it.
 *
 * Freelens gives every sidebar item a `data-testid` built from the extension's
 * name and the item's own id. Driving by that rather than by the visible text
 * matters twice over: a group's text carries its icon's ligature name, so
 * "Trivy" reads as `TrivyTrivykeyboard_arrow_down`, and an entry's label is
 * prose — one page is registered as `cert-manager-unmanaged` and labelled
 * "Unmanaged TLS".
 * The id is matched by suffix, so nothing here needs to know how Freelens turns
 * `@freelens-addons/trivy` into `freelens-addons--trivy`.
 *
 * Expanding is attempted on every pass rather than once up front. The frame's
 * execution context exists before the sidebar is rendered into it, so a single
 * early attempt clicks nothing and the entry never appears — which is a test
 * that passes only while some earlier run happens to have left the group open.
 */
export async function clickSidebar(
  session: Session,
  contextId: number,
  pageId: string,
  groupId?: string,
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

      if (groupId) await expandGroup(session, contextId, groupId);

      return undefined;
    },
    30_000,
  ).catch(async () => {
    const items = await sidebarItems(session, contextId);

    throw new Error(`no sidebar entry with id "${pageId}". Sidebar shows: ${items.join(" | ")}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 1200));
}

/**
 * Widens the cluster view to every namespace, and says so if it could not.
 *
 * The suite must not inherit this. Freelens starts scoped to one namespace, and
 * the selection lives in localStorage on an origin whose port is chosen fresh on
 * every launch — so it is wiped each start and cannot be set up once. Scoped to
 * one namespace, every page in both extensions renders its empty state and a
 * test asserting on rows passes or fails by accident.
 *
 * Only a page built on `KubeObjectListLayout` carries the control, so this is
 * called from such a page. It drives react-select, which opens on a pointer
 * sequence rather than a click and renders its menu into a portal — hence one
 * page-side routine: the menu closes as soon as the protocol round-trips.
 */
export async function selectAllNamespaces(session: Session, contextId: number): Promise<void> {
  const outcome = await session.evaluate<string>(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fire = (element) => {
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      };

      const control = document.querySelector('[class*="Select__control"]');
      if (!control) return "no namespace select on this page";

      fire(control);

      for (let attempt = 0; attempt < 25; attempt++) {
        const all = [...document.querySelectorAll('[id*="option"]')]
          .find((option) => option.textContent.trim() === "All Namespaces");

        if (all) { fire(all); return "selected"; }

        await wait(200);
      }

      return "the namespace menu never opened";
    })()`,
    contextId,
  );

  if (outcome !== "selected") throw new Error(`could not widen the namespace scope: ${outcome}`);

  await new Promise((resolve) => setTimeout(resolve, 2500));
}

/**
 * Narrows the cluster view to one namespace, for a test about scope itself.
 *
 * Shares its awkwardness with {@link selectAllNamespaces}: react-select, a
 * portal, and one page-side routine. An option's text carries its icon's
 * ligature name and a tick when selected, so `layers`, `check` and the
 * whitespace around them come off before the name is compared.
 */
export async function selectNamespace(
  session: Session,
  contextId: number,
  namespace: string,
): Promise<void> {
  const outcome = await session.evaluate<string>(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fire = (element) => {
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
        }
      };
      const named = (option) =>
        option.textContent.replace("layers", "").replace("check", "").trim();

      const control = document.querySelector('[class*="Select__control"]');
      if (!control) return "no namespace select on this page";

      fire(control);

      for (let attempt = 0; attempt < 25; attempt++) {
        const wanted = [...document.querySelectorAll('[id*="option"]')]
          .find((option) => named(option) === ${JSON.stringify(namespace)});

        if (wanted) { fire(wanted); return "selected"; }

        await wait(200);
      }

      return "no option for that namespace";
    })()`,
    contextId,
  );

  if (outcome !== "selected") {
    throw new Error(`could not scope to ${namespace}: ${outcome}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2500));
}

/**
 * One cluster, every namespace, and a frame to drive — what every file needs
 * before its first assertion.
 */
export async function openWorkbench(): Promise<{
  session: Session;
  frame: number;
  errors: { drain: () => ConsoleError[] };
}> {
  const session = await connect();
  const errors = collectErrors(session);

  await openCluster(session);

  let frame = await clusterFrame(session);

  // A host list page, because that is where the namespace control lives.
  await clickSidebar(session, frame, "pods", "workloads");
  await selectAllNamespaces(session, frame);

  frame = await clusterFrame(session);

  return { session, frame, errors };
}

/**
 * Hovers an element and hands back whatever tooltip became visible.
 *
 * Freelens renders a tooltip into a portal, keyed to an id on the element it
 * describes, and it opens on a pointer sequence rather than on a bare
 * `mouseover`. The empty string means nothing appeared, which is a result rather
 * than an error: most elements have no tooltip.
 */
export async function hoverForTooltip(
  session: Session,
  contextId: number,
  selector: string,
): Promise<string> {
  return session.evaluate<string>(
    `(async () => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) throw new Error('nothing matching ' + ${JSON.stringify(selector)});

      for (const type of ["pointerenter", "pointerover", "mouseenter", "mouseover", "mousemove"]) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const tooltip = [...document.querySelectorAll('[class*="Tooltip"]')]
        .find((each) => each.className.includes("visible"));

      return tooltip ? tooltip.textContent.trim() : "";
    })()`,
    contextId,
  );
}

/** One computed property of the first element matching `selector`. */
export async function computedStyle(
  session: Session,
  contextId: number,
  selector: string,
  property: string,
): Promise<string> {
  return session.evaluate<string>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('nothing matching ' + ${JSON.stringify(selector)});
      return getComputedStyle(element).getPropertyValue(${JSON.stringify(property)}).trim();
    })()`,
    contextId,
  );
}

/**
 * What a host theme variable resolves to, in the same form a computed style
 * reports.
 *
 * Read directly, `--textColorPrimary` comes back as it was written — `#8e9297` —
 * while a computed `color` is `rgb(142, 146, 151)`. So the value is put on a
 * throwaway element and read back, which is the only way to compare the two.
 */
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

/** Whether an element's content is wider than the element, i.e. it scrolls sideways. */
export async function overflowsSideways(
  session: Session,
  contextId: number,
  selector: string,
): Promise<number> {
  return session.evaluate<number>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('nothing matching ' + ${JSON.stringify(selector)});
      return element.scrollWidth - element.clientWidth;
    })()`,
    contextId,
  );
}

/**
 * How many objects the cluster has of one kind, asked of the cluster rather than
 * of the page.
 *
 * The frame can reach the host's own Kubernetes proxy on its origin, which makes
 * the cluster the source of truth for a count the page renders — instead of a
 * number written into a test, which is the development cluster's contents on the
 * day it was written.
 */
export async function clusterItems<Item = Record<string, unknown>>(
  session: Session,
  contextId: number,
  apiPath: string,
): Promise<Item[]> {
  const body = await session.evaluate<string>(
    `fetch(${JSON.stringify(`/api-kube${apiPath}`)}).then((response) => response.text())`,
    contextId,
  );

  const parsed = JSON.parse(body) as { items?: Item[] };

  if (!Array.isArray(parsed.items)) {
    throw new Error(`${apiPath} did not answer with a list: ${body.slice(0, 200)}`);
  }

  return parsed.items;
}

/** Clicks the first element matching `selector` whose text contains `text`. */
export async function clickByText(
  session: Session,
  contextId: number,
  selector: string,
  text: string,
): Promise<void> {
  const clicked = await session.evaluate<boolean>(
    `(() => {
      const found = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((each) => each.textContent.includes(${JSON.stringify(text)}));
      if (!found) return false;
      found.click();
      return true;
    })()`,
    contextId,
  );

  if (!clicked) throw new Error(`no ${selector} containing ${JSON.stringify(text)}`);

  await new Promise((resolve) => setTimeout(resolve, 900));
}

/**
 * Waits for a notification that says `text`, among however many are showing.
 *
 * Freelens stacks them and each stays a few seconds, so a test that copies twice
 * in a row sees the first one still on top when the second arrives. Reading "the
 * notification" then reads the previous one; this reads all of them.
 */
export async function notificationSaying(
  session: Session,
  contextId: number,
  text: string,
): Promise<string> {
  return waitFor(`a notification saying ${JSON.stringify(text)}`, async () => {
    const found = await session.evaluate<string>(
      `[...document.querySelectorAll('[class*="notification"]')]
         .map((each) => each.textContent.trim())
         .find((each) => each.includes(${JSON.stringify(text)})) ?? ""`,
      contextId,
    );

    return found.length > 0 ? found : undefined;
  });
}

/** The text of the notification Freelens is showing, waited for. */
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

/**
 * Types into a field the way the renderer expects. Setting `.value` does not
 * move a React controlled input, so the native setter is called and an input
 * event dispatched, which is what React listens for.
 */
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
