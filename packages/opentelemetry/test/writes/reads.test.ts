import { Renderer } from "@freelensapp/extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";
import {
  listOperatorDeployments,
  listSecretNames,
  readPreviousLog,
} from "../../src/renderer/api/writes/actions";
import secretNamesJson from "../fixtures/secret-names.json";
import { exitedCollectorPod, operatorDeployments, podOf, secretNames } from "../support/fixtures";

const hung = () => new Promise<never>(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Renderer.K8sApi, "podsApi");
});

describe("a read with a timeout", () => {
  it("gives up on a read that never answers, and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = withTimeout((given) => {
      signal = given;

      return hung();
    });
    const outcome = expect(read).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });

  it("keeps an answer that comes in time, and leaves no timer behind", async () => {
    vi.useFakeTimers();

    await expect(withTimeout(async () => secretNamesJson)).resolves.toEqual(secretNamesJson);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("cluster reads that never answer", () => {
  it("a namespace whose names never come is refused, and the others are listed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (url: string) =>
      url.includes("/namespaces/otel-tls/")
        ? Promise.resolve(new Response(JSON.stringify(secretNamesJson)))
        : hung(),
    );
    const listed = listSecretNames(["otel-apps", "otel-tls"]);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    const listings = await listed;

    expect(listings.get("otel-apps")).toEqual({ error: "No answer in 20s" });
    expect(listings.get("otel-tls")).toEqual(secretNames());
  });

  it("the operator's Deployments and a previous log reject instead of waiting for ever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hung);
    Object.assign(Renderer.K8sApi, { podsApi: { getLogs: hung } });
    const operator = expect(listOperatorDeployments()).rejects.toThrow("No answer in 20s");
    const log = expect(readPreviousLog(exitedCollectorPod())).rejects.toThrow("No answer in 20s");

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await operator;
    await log;
  });

  it("the operator's Deployments that answer in time are read", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ items: operatorDeployments() })),
    );

    await expect(listOperatorDeployments()).resolves.toEqual(operatorDeployments());
  });
});

describe("a crash's log", () => {
  it("is read from the run that exited, whether or not its back-off has begun", async () => {
    const asked: { previous?: boolean }[] = [];

    Object.assign(Renderer.K8sApi, {
      podsApi: {
        getLogs: async (_pod: unknown, options: { previous?: boolean }) => {
          asked.push(options);

          return "";
        },
      },
    });
    await readPreviousLog(exitedCollectorPod());
    await readPreviousLog(podOf("otel-collectors", "broken"));

    expect(asked.map((options) => options.previous)).toEqual([false, true]);
  });
});
