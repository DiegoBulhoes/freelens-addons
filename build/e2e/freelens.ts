import { type ExecutionContext, listTargets, Session } from "./cdp";

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

// Contexts are replaced on reload, so never cached. Re-enabling Runtime replays one creation
// event per live context; CDP has no call that lists them.
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

// Newest first and only once it answers: a reload creates the new context before the old one
// is reported destroyed.
export async function clusterFrame(session: Session): Promise<number> {
  return waitFor("the cluster frame", async () => {
    const candidates = (await contexts(session))
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

// Groups are listed outermost first. Expanding runs on every pass: the context exists before
// the sidebar renders into it.
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

  await new Promise((resolve) => setTimeout(resolve, 1200));
}

// Needs a `KubeObjectListLayout` page. react-select opens on a pointer sequence and its menu
// closes on a protocol round-trip, so it all runs in one page-side routine.
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

// As selectAllNamespaces. An option's text includes the `layers` and `check` icon ligatures.
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

export async function openWorkbench(): Promise<{
  session: Session;
  frame: number;
  errors: { drain: () => ConsoleError[] };
}> {
  const session = await connect();
  const errors = collectErrors(session);

  await openCluster(session);

  let frame = await clusterFrame(session);

  // A host list page: the namespace control lives there.
  await clickSidebar(session, frame, "pods", "workloads");
  await selectAllNamespaces(session, frame);

  frame = await clusterFrame(session);

  return { session, frame, errors };
}

// Tooltips open on a pointer sequence, not a bare `mouseover`. "" means none appeared.
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
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('nothing matching ' + ${JSON.stringify(selector)});
      return element.scrollWidth - element.clientWidth;
    })()`,
    contextId,
  );
}

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

// Notifications stack, so the first one may be a previous action's.
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
export function openDrawer(drawer: string): string {
  return `[...document.querySelectorAll(${JSON.stringify(drawer)})].filter((each) => each.querySelector("[data-section]")).at(-1)`;
}

/** Without the copy icon the host puts in the title. */
export function drawerTitle(session: Session, contextId: number, drawer: string): Promise<string> {
  return session.evaluate<string>(
    `[...(${openDrawer(drawer)}?.querySelector(".drawer-title-text")?.childNodes ?? [])]
       .filter((each) => each.nodeType === Node.TEXT_NODE).map((each) => each.textContent).join("").trim()`,
    contextId,
  );
}
