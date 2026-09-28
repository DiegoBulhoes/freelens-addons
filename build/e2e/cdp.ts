/**
 * The smallest Chrome DevTools Protocol client that can drive Freelens.
 *
 * Not Playwright. It would do this well, and it brings a browser download and a
 * dependency tree into a repository whose rules are a fifteen-day age floor and
 * no third-party code in CI. Node 24 ships a WebSocket, the protocol is JSON
 * over it, and what is needed here is evaluate, click and type.
 */

export interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface ExecutionContext {
  id: number;
  origin: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

const CALL_TIMEOUT_MS = 15_000;

export class Session {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, ((params: never) => void)[]>();
  private nextId = 1;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => this.receive(String(event.data)));
  }

  static async open(webSocketDebuggerUrl: string): Promise<Session> {
    const socket = new WebSocket(webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("could not open the CDP socket")), {
        once: true,
      });
    });

    return new Session(socket);
  }

  private receive(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: never;
      result?: unknown;
      error?: { message: string };
    };

    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);

      this.pending.delete(message.id);

      if (!waiting) return;
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);

      return;
    }

    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params as never);
      }
    }
  }

  on<Params>(method: string, listener: (params: Params) => void): void {
    const existing = this.listeners.get(method) ?? [];

    existing.push(listener as (params: never) => void);
    this.listeners.set(method, existing);
  }

  send<Result = unknown>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    const id = this.nextId++;

    this.socket.send(JSON.stringify({ id, method, params }));

    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not answer within ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as Result);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
    });
  }

  /**
   * `contextId` is what makes this work at all: the cluster frame is an iframe
   * of another origin inside the same page, so it is not a target of its own
   * and the default context cannot see it.
   */
  async evaluate<Result>(expression: string, contextId?: number): Promise<Result> {
    const response = await this.send<{
      result: { value: Result };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId === undefined ? {} : { contextId }),
    });

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    }

    return response.result.value;
  }

  close(): void {
    this.socket.close();
  }
}

export async function listTargets(port: number): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);

  return (await response.json()) as Target[];
}
