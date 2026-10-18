import { afterEach, describe, expect, it, vi } from "vitest";

import { listRejectionEvents } from "../../src/renderer/api/shared/actions";
import { READ_TIMEOUT_MS } from "../../src/renderer/api/shared/read-timeout";
import {
  describeRefusedEvents,
  nextRetryDelay,
  REJECTIONS_MS,
  rejectionsFrom,
  settleRejections,
} from "../../src/renderer/api/shared/rejections";
import { events } from "../support/fixtures";

describe("rejections", () => {
  it("the operator rejected the ServiceMonitor rejected and the PrometheusRule broken-rule", () => {
    const rejections = rejectionsFrom(events());

    expect([...rejections.keys()]).toEqual([
      "ServiceMonitor/monitoring/rejected",
      "PrometheusRule/prom-apps/broken-rule",
    ]);
    expect(rejections.get("ServiceMonitor/monitoring/rejected")).toEqual({
      message:
        '"monitoring/rejected" was rejected due to invalid configuration: endpoints[0]: scrapeTimeout "30s" greater than scrapeInterval "10s"',
      at: "2026-10-12T16:34:10.225868Z",
      uid: "89ac45c3-43e2-48e1-8544-34538fc4f36d",
    });
  });

  it("keeps the newest message whatever the order", () => {
    const [older, newer] = events();
    const changed = newer && { ...newer, message: "newer" };

    expect(
      changed &&
        older &&
        rejectionsFrom([changed, older]).get("ServiceMonitor/monitoring/rejected")?.message,
    ).toBe("newer");
  });

  it("reads an events.k8s.io Event, and ignores other reasons", () => {
    const [event] = events();
    const modern = event && {
      reason: event.reason,
      regarding: event.involvedObject,
      note: "from events.k8s.io",
      metadata: event.metadata,
    };

    expect(modern && rejectionsFrom([modern]).get("ServiceMonitor/monitoring/rejected")).toEqual({
      message: "from events.k8s.io",
      at: event?.metadata?.creationTimestamp,
      uid: event?.involvedObject?.uid,
    });
    expect(event && rejectionsFrom([{ ...event, reason: "Scheduled" }]).size).toBe(0);
    expect(event && rejectionsFrom([{ ...event, involvedObject: undefined }]).size).toBe(0);
    expect(
      event &&
        rejectionsFrom([{ reason: event.reason, involvedObject: event.involvedObject }]).get(
          "ServiceMonitor/monitoring/rejected",
        ),
    ).toEqual({ message: "", at: undefined, uid: event?.involvedObject?.uid });
  });
});

describe("Events listed namespace by namespace", () => {
  const [rejected, , broken] = events();

  it("one refused namespace keeps the others' rejections, and is named", () => {
    const read = settleRejections(
      ["monitoring", "prom-outside", "prom-apps"],
      [
        { status: "fulfilled", value: rejected ? [rejected] : [] },
        { status: "rejected", reason: new Error("403 Forbidden") },
        { status: "fulfilled", value: broken ? [broken] : [] },
      ],
    );

    expect([...read.rejections.keys()]).toEqual([
      "ServiceMonitor/monitoring/rejected",
      "PrometheusRule/prom-apps/broken-rule",
    ]);
    expect(read.refused).toEqual(["prom-outside"]);
  });

  it("the page says where a rejection is not known", () => {
    expect(describeRefusedEvents([])).toBeUndefined();
    expect(describeRefusedEvents(["prom-outside", "prom-apps"])).toBe(
      "The operator's Events could not be read in prom-apps, prom-outside, so a rejection there is not shown.",
    );
  });
});

describe("reading the operator's Events", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up on a namespace that never answers, and keeps the others' rejections", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url.includes("/namespaces/monitoring/")) {
        return new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }
      const items = events().filter((event) =>
        url.includes(`/namespaces/${event.involvedObject?.namespace}/`),
      );

      return Promise.resolve(new Response(JSON.stringify({ items })));
    });
    const read = listRejectionEvents(["monitoring", "prom-apps"]);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    const { rejections, refused } = await read;

    expect(refused).toEqual(["monitoring"]);
    expect([...rejections.keys()]).toEqual(["PrometheusRule/prom-apps/broken-rule"]);
  });

  it("tries a refused namespace again 2s later, doubling up to the regular read", () => {
    expect([1, 2, 3, 5, 6, 9].map(nextRetryDelay)).toEqual([
      2_000,
      4_000,
      8_000,
      32_000,
      REJECTIONS_MS,
      REJECTIONS_MS,
    ]);
    expect(nextRetryDelay(0)).toBe(REJECTIONS_MS);
  });
});
