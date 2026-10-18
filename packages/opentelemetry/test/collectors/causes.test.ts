import { describe, expect, it } from "vitest";

import {
  afterRead,
  type CauseRead,
  CRASH_WINDOW,
  causeFromLog,
  causeKey,
  collectorStatusOf,
  crashLogIsPrevious,
  crashOf,
  isDue,
  MAX_ATTEMPTS,
  MAX_READS,
  needsLog,
  RETRY_MS,
  readSlots,
  retryIn,
  startRead,
  UNREADABLE,
} from "../../src/renderer/api/collectors/causes";
import { ALLOCATOR_CONTAINER } from "../../src/renderer/api/coverage/workload-pods";
import { collectorLog, exitedCollectorPod, NOW, podOf, pods, variant } from "../support/fixtures";

const broken = () => podOf("otel-collectors", "broken");
const gateway = () => podOf("otel-collectors", "gateway");
const restarts = () => collectorStatusOf(broken())?.restartCount;
const LATER = NOW + 24 * 3_600_000;
const allocatorPod = () => {
  const found = pods().find((pod) => pod.getName().startsWith("allocator-targetallocator-"));

  if (!found) throw new Error("no allocator pod in the fixture");

  return found;
};
/** broken's pod as if the kernel had killed it for memory. */
const oomKilled = () =>
  variant(broken(), (data) => {
    data.status = {
      ...data.status,
      containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
        ...status,
        state: { waiting: { reason: "CrashLoopBackOff" } },
        lastState: {
          terminated: { ...status.lastState?.terminated, reason: "OOMKilled", exitCode: 137 },
        },
      })),
    };
  });

describe("the collector's own words", () => {
  it("reads the error its command printed before exiting", () => {
    expect(causeFromLog(collectorLog())).toBe(
      'invalid configuration: service::pipelines::traces: references exporter "debugg" which is not configured',
    );
  });

  it("finds nothing in an empty log, or one without that line", () => {
    expect(causeFromLog("")).toBeUndefined();
    expect(causeFromLog(collectorLog().replace("Error: ", ""))).toBeUndefined();
  });

  it("falls back to a Go panic's first line", () => {
    const panicked = collectorLog().replace(
      /^Error: .*$/m,
      "panic: runtime error: invalid memory address\npanic: second [recovered]",
    );

    expect(causeFromLog(panicked)).toBe("panic: runtime error: invalid memory address");
  });
});

describe("a crash loop", () => {
  it("is a collector that exited within the window and is not ready", () => {
    expect(crashOf(exitedCollectorPod(), NOW)).toMatchObject({
      exitCode: 1,
      reason: "Error",
      restarts: restarts(),
    });
    expect(crashOf(broken(), NOW)).toBeDefined();
    expect(crashOf(gateway(), NOW)).toBeUndefined();
  });

  it("is not an exit from long ago, once the window has passed", () => {
    expect(crashOf(exitedCollectorPod(), LATER)).toBeUndefined();
    expect(LATER - NOW).toBeGreaterThan(CRASH_WINDOW);
  });

  it("is not a ready collector that once exited, as after a k3s restart", () => {
    const restarted = variant(gateway(), (data) => {
      data.status = {
        ...data.status,
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          restartCount: 1,
          lastState: collectorStatusOf(broken())?.lastState,
        })),
      };
    });

    expect(crashOf(restarted, NOW)).toBeUndefined();
  });

  it("is a container in back-off, whenever it last exited", () => {
    const backingOff = variant(broken(), (data) => {
      data.status = {
        ...data.status,
        containerStatuses: (data.status?.containerStatuses ?? []).map((status) => ({
          ...status,
          state: { waiting: { reason: "CrashLoopBackOff" } },
        })),
      };
    });

    expect(crashOf(backingOff, LATER)).toMatchObject({ exitCode: 1, restarts: restarts() });
  });

  it("reads a native sidecar's status among the init containers", () => {
    const status = collectorStatusOf(broken());
    const sidecar = variant(podOf("otel-late", "late"), (data) => {
      data.status = { ...data.status, initContainerStatuses: status ? [status] : [] };
    });

    expect(crashOf(sidecar, NOW)?.restarts).toBe(restarts());
  });

  it("is nothing for a pod without the collector's container", () => {
    expect(crashOf(podOf("otel-late", "late"), NOW)).toBeUndefined();
  });

  it("is read from the container named, as the target allocator's", () => {
    expect(crashOf(allocatorPod(), NOW)).toBeUndefined();
    expect(crashOf(allocatorPod(), NOW, ALLOCATOR_CONTAINER)).toMatchObject({
      exitCode: 137,
      reason: "OOMKilled",
    });
  });

  it("wants no log read when the kernel killed it for memory", () => {
    const killed = crashOf(oomKilled(), NOW);
    const errored = crashOf(broken(), NOW);

    expect(killed?.reason).toBe("OOMKilled");
    expect(killed && needsLog(killed)).toBe(false);
    expect(errored && needsLog(errored)).toBe(true);
  });
});

describe("the key a cause is kept under", () => {
  it("changes with each restart", () => {
    expect(causeKey(broken())).toBe(`${broken().metadata.uid}/${restarts()}`);
    expect(causeKey(podOf("otel-late", "late"))).toBe(
      `${podOf("otel-late", "late").metadata.uid}/0`,
    );
  });
});

describe("reading a crash's previous log", () => {
  const missed = (read: CauseRead, at = NOW) => afterRead(read, { log: "" }, at);

  it("is due once, and not while a read is in flight", () => {
    const started = startRead(undefined);

    expect(isDue(undefined, NOW)).toBe(true);
    expect(started).toEqual({ cause: undefined, attempts: 1, final: false });
    expect(isDue(started, LATER)).toBe(false);
  });

  it("stops at a log with text, whether or not it names a cause", () => {
    const found = afterRead(startRead(undefined), { log: collectorLog() }, NOW);
    const silent = afterRead(
      startRead(undefined),
      { log: collectorLog().replace("Error: ", "") },
      NOW,
    );

    expect(found).toMatchObject({ final: true, cause: causeFromLog(collectorLog()) });
    expect(silent).toMatchObject({ final: true, cause: undefined });
    expect(isDue(silent, LATER)).toBe(false);
    expect(retryIn([found, silent], NOW)).toBeUndefined();
  });

  it("tries again when the kubelet says that run's log is gone", () => {
    const gone = afterRead(
      startRead(undefined),
      { log: "unable to retrieve container logs for containerd://5d2196a2c85b" },
      NOW,
    );

    expect(gone).toMatchObject({ attempts: 1, cause: undefined, missedAt: NOW, final: false });
  });

  it("reads the exited run itself before the back-off, and the previous one during it", () => {
    expect(crashLogIsPrevious(exitedCollectorPod())).toBe(false);
    expect(crashLogIsPrevious(broken())).toBe(true);
  });

  it("tries an empty log again with back-off, at most three times", () => {
    const first = missed(startRead(undefined));

    expect(first).toMatchObject({ attempts: 1, missedAt: NOW, final: false });
    expect(isDue(first, NOW + RETRY_MS - 1)).toBe(false);
    expect(isDue(first, NOW + RETRY_MS)).toBe(true);

    const second = missed(startRead(first));

    expect(isDue(second, NOW + RETRY_MS)).toBe(false);
    expect(isDue(second, NOW + 2 * RETRY_MS)).toBe(true);

    const third = missed(startRead(second));

    expect(third.attempts).toBe(MAX_ATTEMPTS);
    expect(third.final).toBe(true);
    expect(isDue(third, LATER)).toBe(false);
  });

  it("says a refused read could not be read, and tries it again", () => {
    const refused = afterRead(startRead(undefined), { error: new Error("forbidden") }, NOW);

    expect(refused).toMatchObject({ cause: UNREADABLE, missedAt: NOW, final: false });
    expect(startRead(refused).cause).toBe(UNREADABLE);
    expect(afterRead(startRead(refused), { log: collectorLog() }, NOW).cause).toBe(
      causeFromLog(collectorLog()),
    );
  });

  it("waits for the first missed read that will be due", () => {
    const first = missed(startRead(undefined));
    const second = missed(startRead(first), NOW + 1_000);

    expect(retryIn([undefined, startRead(undefined), first, second], NOW)).toBe(RETRY_MS);
    expect(retryIn([second], NOW + 1_000)).toBe(2 * RETRY_MS);
    expect(retryIn([first], LATER)).toBe(0);
  });

  it("counts the reads in flight against the cap", () => {
    expect(readSlots(0)).toBe(MAX_READS);
    expect(readSlots(MAX_READS - 3)).toBe(3);
    expect(readSlots(MAX_READS + 2)).toBe(0);
  });
});
