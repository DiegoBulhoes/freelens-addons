import type { Session } from "./cdp";
import { typeInto, waitFor } from "./freelens";

// The write suites change the cluster through the extension and read the effect back through the
// window's own proxy, so they can only ever reach the cluster openWorkbench checked.

// biome-ignore lint/suspicious/noExplicitAny: Kubernetes objects are read loosely here.
export type KubeObject = Record<string, any>;

export async function clusterObject(
  session: Session,
  contextId: number,
  apiPath: string,
): Promise<KubeObject | undefined> {
  const { status, body } = await session.evaluate<{ status: number; body: string }>(
    `fetch(${JSON.stringify(`/api-kube${apiPath}`)}).then(async (response) => ({ status: response.status, body: await response.text() }))`,
    contextId,
  );

  if (status === 404) return undefined;
  if (status >= 300) throw new Error(`GET ${apiPath}: ${status} ${body.slice(0, 200)}`);

  return JSON.parse(body) as KubeObject;
}

/** Only to put the seed back after a test: the write under test always goes through the UI. */
export async function restore(
  session: Session,
  contextId: number,
  method: "PATCH" | "DELETE",
  apiPath: string,
  patch?: object,
  contentType = "application/merge-patch+json",
): Promise<void> {
  const { status, body } = await session.evaluate<{ status: number; body: string }>(
    `fetch(${JSON.stringify(`/api-kube${apiPath}`)}, {
      method: ${JSON.stringify(method)},
      headers: { "Content-Type": ${JSON.stringify(contentType)} },
      body: ${patch ? JSON.stringify(JSON.stringify(patch)) : "undefined"},
    }).then(async (response) => ({ status: response.status, body: await response.text() }))`,
    contextId,
  );

  if (status >= 300 && status !== 404) {
    throw new Error(`${method} ${apiPath}: ${status} ${body.slice(0, 200)}`);
  }
}

/** Polls the cluster every 3s: operators take seconds to minutes to act. */
export function untilCluster<T>(
  what: string,
  check: () => Promise<T | undefined | false>,
  timeoutMs = 5 * 60_000,
): Promise<T> {
  return waitFor(
    what,
    async () => {
      const value = await check();

      if (value === undefined || value === false) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }

      return value;
    },
    timeoutMs,
  ) as Promise<T>;
}

/** Runs a command in a container through the window's proxy, as kubectl exec does; returns stdout. */
export function execIn(
  session: Session,
  contextId: number,
  namespace: string,
  pod: string,
  container: string,
  command: string[],
): Promise<string> {
  const query = new URLSearchParams([
    ["container", container],
    ...command.map((part) => ["command", part]),
    ["stdout", "true"],
    ["stderr", "true"],
  ]);
  const path = `/api-kube/api/v1/namespaces/${namespace}/pods/${pod}/exec?${query}`;

  return session.evaluate<string>(
    `new Promise((resolve, reject) => {
      const socket = new WebSocket(location.origin.replace(/^http/, "ws") + ${JSON.stringify(path)}, ["v4.channel.k8s.io"]);
      const decoder = new TextDecoder();
      let stdout = "";
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => {
        const frame = new Uint8Array(event.data);
        if (frame[0] === 1) stdout += decoder.decode(frame.slice(1));
      };
      socket.onerror = () => reject(new Error("exec into ${pod} failed"));
      socket.onclose = () => resolve(stdout);
      setTimeout(() => { socket.close(); reject(new Error("exec into ${pod} timed out")); }, 15000);
    })`,
    contextId,
  );
}

export const startTime = (pod: KubeObject | undefined): number =>
  Date.parse(pod?.status?.startTime ?? "") || 0;

/** The dialog every extension opens before a write: types the name when asked, then presses OK. */
export async function confirmDialog(
  session: Session,
  contextId: number,
  okLabel: string,
  typed?: string,
): Promise<string> {
  const text = await waitFor("the confirmation", async () => {
    const found = await session.evaluate<string>(
      "document.querySelector('.ConfirmDialog')?.textContent ?? ''",
      contextId,
    );

    return found || undefined;
  });

  if (typed !== undefined) {
    await typeInto(session, contextId, '.ConfirmDialog input[aria-label="Confirmation"]', typed);
  }

  const pressed = await session.evaluate<boolean>(
    `(() => {
      const button = [...document.querySelectorAll(".ConfirmDialog button")].find((each) => each.textContent.includes(${JSON.stringify(okLabel)}));
      button?.click();
      return Boolean(button);
    })()`,
    contextId,
  );

  if (!pressed) throw new Error(`no "${okLabel}" button in the dialog: ${text.slice(-300)}`);

  await waitFor("the dialog to close", async () =>
    (await session.evaluate<number>(
      "document.querySelectorAll('.ConfirmDialog').length",
      contextId,
    )) === 0
      ? true
      : undefined,
  );

  return text;
}

/** Every notification on screen, newest last; the suites wait on the one their write reports. */
export function notifications(session: Session, contextId: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll('[class*="notification"]')].map((each) => each.textContent.trim())`,
    contextId,
  );
}

export function notificationMatching(
  session: Session,
  contextId: number,
  pattern: RegExp,
  timeoutMs = 60_000,
): Promise<string> {
  return waitFor(
    `a notification matching ${pattern}`,
    async () => (await notifications(session, contextId)).find((each) => pattern.test(each)),
    timeoutMs,
  );
}

/**
 * Clicks the Undo in the notification matching `notice`, and waits for the notification it adds.
 * Several can offer the same label at once: an earlier test's may still be on screen.
 */
export async function clickUndo(
  session: Session,
  contextId: number,
  notice: RegExp,
  done = /Undone\./,
  label = "Undo",
): Promise<void> {
  // Marked, so an "Undone." still on screen from an earlier test is not taken for this one.
  const clicked = await session.evaluate<boolean>(
    `(() => {
      document.querySelectorAll('[class*="notification"]').forEach((each) => each.setAttribute("data-seen", ""));
      const button = [...document.querySelectorAll('[class*="notification"] button')]
        .filter((each) => each.textContent.trim() === ${JSON.stringify(label)})
        .find((each) => new RegExp(${JSON.stringify(notice.source)}).test(each.parentElement?.textContent ?? ""));
      button?.click();
      return Boolean(button);
    })()`,
    contextId,
  );

  if (!clicked)
    throw new Error(`no notification matching ${notice} offers ${JSON.stringify(label)}`);

  await waitFor(
    `a notification matching ${done}`,
    async () =>
      (await session.evaluate<boolean>(
        `[...document.querySelectorAll('[class*="notification"]:not([data-seen])')].some((each) => new RegExp(${JSON.stringify(done.source)}).test(each.textContent))`,
        contextId,
      )) || undefined,
  );
}
