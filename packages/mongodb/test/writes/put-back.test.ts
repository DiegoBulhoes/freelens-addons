import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { putBackWith } from "../../../../build/e2e/writes";

// The writes suites' restores wait on the cluster for minutes, past hookTimeout.
describe("putBackWith", () => {
  const putBack = putBackWith(onTestFinished);
  let ran = false;

  afterAll(() => {
    vi.resetConfig();
    expect(ran).toBe(true);
  });

  it("gives a step its own timeout, longer than hookTimeout", () => {
    vi.setConfig({ hookTimeout: 20 });
    putBack(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      ran = true;
    }, 2000);
  });
});
