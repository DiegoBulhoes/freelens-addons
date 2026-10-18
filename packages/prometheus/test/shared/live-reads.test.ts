import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrometheusRead } from "../../src/renderer/api/monitors/scrape-pools";
import {
  askInTurn,
  JoinedReads,
  liveState,
  ReadGate,
  SharedReads,
} from "../../src/renderer/api/shared/live-reads";
import { READ_TIMEOUT_MS, withTimeout } from "../../src/renderer/api/shared/read-timeout";
import type { MetricData } from "../../src/renderer/api/shared/types";
import { alertingReads, reads, targetsBody, usageItem } from "../support/fixtures";

const hung = () => new Promise<never>(() => {});

describe("a read with a timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a Prometheus that never answers, and aborts its request", async () => {
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

    await expect(withTimeout(async () => targetsBody())).resolves.toEqual(targetsBody());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("one read per key, joined", () => {
  it("asking again while a read is pending gets its answer instead of a second read", async () => {
    const joined = new JoinedReads<unknown>();
    let answer: (body: unknown) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise((done) => {
          answer = done;
        }),
    );
    const first = joined.join("monitoring,prom-apps", read);
    const second = joined.join("monitoring,prom-apps", read);

    answer(targetsBody());

    expect(await second).toEqual(await first);
    expect(read).toHaveBeenCalledTimes(1);
    const again = joined.join("monitoring,prom-apps", read);

    answer(targetsBody());
    await again;
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("one read per source at a time", () => {
  it("asks nothing while the same source is still being read", async () => {
    const gate = new ReadGate();
    let answer: (body: unknown) => void = () => {};
    const first = gate.run(
      "Prometheus/monitoring/seed",
      () =>
        new Promise((done) => {
          answer = done;
        }),
    );
    const second = vi.fn(async () => targetsBody());

    expect(gate.run("Prometheus/monitoring/seed", second)).toBeUndefined();
    expect(second).not.toHaveBeenCalled();

    answer(targetsBody());
    await expect(first).resolves.toEqual(targetsBody());
    await expect(gate.run("Prometheus/monitoring/seed", second)).resolves.toEqual(targetsBody());
  });

  it("reads other sources meanwhile", async () => {
    const gate = new ReadGate();

    gate.run("Prometheus/monitoring/seed", hung);

    await expect(
      gate.run("TargetAllocator/otel-collectors/scraper", async () => targetsBody()),
    ).resolves.toEqual(targetsBody());
  });

  it("frees the source when a read fails, even before its first await", async () => {
    const gate = new ReadGate();

    await expect(
      gate.run("Prometheus/monitoring/seed", () => {
        throw new Error("pods/proxy forbidden");
      }),
    ).rejects.toThrow("pods/proxy forbidden");
    await expect(
      gate.run("Prometheus/monitoring/seed", async () => {
        throw new Error("No answer in 20s");
      }),
    ).rejects.toThrow("No answer in 20s");
    expect(gate.run("Prometheus/monitoring/seed", async () => targetsBody())).toBeDefined();
  });
});

describe("answers shared by the pages", () => {
  it("asks once while pending, and tells every page shown when it lands", async () => {
    const [seed] = reads();
    const shared = new SharedReads<PrometheusRead>();
    let answer: (read: PrometheusRead) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<PrometheusRead>((done) => {
          answer = done;
        }),
    );
    const monitorsPage = vi.fn();
    const closedPage = vi.fn();
    const rulesPage = vi.fn();

    shared.subscribe(monitorsPage);
    shared.subscribe(closedPage)();
    shared.ask("Prometheus/monitoring/seed", read);
    shared.ask("Prometheus/monitoring/seed", read);
    shared.subscribe(rulesPage);
    if (seed) answer(seed);
    await vi.waitFor(() => expect(rulesPage).toHaveBeenCalledTimes(1));

    expect(read).toHaveBeenCalledTimes(1);
    expect(monitorsPage).toHaveBeenCalledTimes(1);
    expect(closedPage).not.toHaveBeenCalled();
    expect(shared.get("Prometheus/monitoring/seed")).toBe(seed);
    expect(shared.get("Prometheus/prom-broken/no-image")).toBeUndefined();
  });
});

describe("queries asked in turn", () => {
  const cpu = usageItem("podCpu");
  const memory = usageItem("podMemory");
  const queries = { cpu: cpu.query, memory: memory.query };
  const answers: Record<string, MetricData> = {
    [cpu.query]: cpu.response,
    [memory.query]: memory.response,
  };

  it("answers each query, and a failed one as no data with its error", async () => {
    const ask = async (query: string) => {
      if (query === memory.query) throw new Error("No answer in 20s");
      if (query === "refused") return Promise.reject("refused");

      return answers[query] ?? {};
    };

    expect(await askInTurn(queries, ask)).toEqual({
      cpu: cpu.response,
      memory: { status: "error", error: "No answer in 20s" },
    });
    expect(await askInTurn({ odd: "refused" }, ask)).toEqual({
      odd: { status: "error", error: "refused" },
    });
  });

  it("stops asking once the answer is no longer wanted", async () => {
    let wanted = true;
    const ask = vi.fn(async (query: string) => {
      wanted = false;

      return answers[query] ?? {};
    });

    expect(await askInTurn(queries, ask, () => !wanted)).toEqual({ cpu: cpu.response });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("whether the live reads have landed, for the e2e suites to wait on", () => {
  const sourcesOf = (answers: { source: string }[]) => answers.map((each) => each.source);
  const settled = {
    loading: false,
    reads: [
      { asked: sourcesOf(reads()), answers: reads() },
      { asked: sourcesOf(alertingReads()), answers: alertingReads() },
    ],
    eventsWanted: "monitoring,prom-apps",
    eventsRead: "monitoring,prom-apps",
  };

  it("reads as read once every source asked has answered and the Events are read", () => {
    expect(reads().length).toBeGreaterThan(1);
    expect(liveState(settled)).toBe("read");
  });

  it("reads as reading while the stores load", () => {
    expect(liveState({ ...settled, loading: true })).toBe("reading");
  });

  it("reads as reading while one source has not answered", () => {
    const [, ...rest] = reads();

    expect(liveState({ ...settled, reads: [{ asked: sourcesOf(reads()), answers: rest }] })).toBe(
      "reading",
    );
  });

  it("does not take a Prometheus's Alertmanager answer for its targets", () => {
    const asked = sourcesOf(alertingReads());

    expect(asked.length).toBeGreaterThan(0);
    expect(
      liveState({
        ...settled,
        reads: [
          { asked, answers: [] },
          { asked, answers: alertingReads() },
        ],
      }),
    ).toBe("reading");
  });

  it("reads as reading while the Events on hand are another scope's, and asks none when none are wanted", () => {
    expect(liveState({ ...settled, eventsRead: "monitoring" })).toBe("reading");
    expect(liveState({ ...settled, eventsRead: undefined })).toBe("reading");
    expect(liveState({ ...settled, eventsWanted: "", eventsRead: undefined })).toBe("read");
  });
});
