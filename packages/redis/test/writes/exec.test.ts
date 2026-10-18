import { describe, expect, it } from "vitest";

import { execCollector } from "../../src/renderer/api/writes/exec";

const frame = (channel: number, text: string) =>
  new Uint8Array([channel, ...new TextEncoder().encode(text)]);

// What the API server sends on channel 3 when the command exits non-zero.
const nonZeroExit = JSON.stringify({
  metadata: {},
  status: "Failure",
  message:
    "command terminated with non-zero exit code: error executing command [sh -c redis-cli -p 26379 SENTINEL failover myMaster], exit code 1",
  reason: "NonZeroExitCode",
  details: { causes: [{ reason: "ExitCode", message: "1" }] },
});

function collect(...frames: Uint8Array[]) {
  const collector = execCollector();

  for (const each of frames) collector.push(each);

  return collector.result();
}

describe("an exec's outcome", () => {
  it("is what it printed on stdout when it succeeds", () => {
    const success = frame(3, JSON.stringify({ status: "Success" }));

    expect(collect(frame(1, "OK\n"), frame(3, ""), success)).toEqual({ stdout: "OK\n" });
  });

  it("names redis-cli's own complaint on stderr, not the exit code", () => {
    const result = collect(
      frame(2, "Could not connect to Redis at 127.0.0.1:26379: Connection refused\n"),
      frame(3, nonZeroExit),
    );

    expect(result.error).toBe("Could not connect to Redis at 127.0.0.1:26379: Connection refused");
  });

  it("falls back to stdout, then to the API server's message", () => {
    const printed = collect(frame(1, "ERR No such master with that name\n"), frame(3, nonZeroExit));

    expect(printed.error).toBe("ERR No such master with that name");
    expect(collect(frame(3, nonZeroExit)).error).toMatch(/exit code 1$/);
    expect(collect(frame(3, JSON.stringify({ status: "Failure" }))).error).toBe(
      "the command failed",
    );
  });
});
