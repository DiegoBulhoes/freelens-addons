import { observable } from "mobx";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

// ConfirmDialog stores its message in a deep `observable.box()`, which copies props; forms must report via callback.
describe("what a ConfirmDialog's message keeps of its props", () => {
  it("copies an object prop, so a form cannot write back through it", () => {
    const shared = { prune: false };
    const box = observable.box<unknown>();

    box.set({ message: createElement("div", { choice: shared }) });

    const kept = (box.get() as { message: { props: { choice: { prune: boolean } } } }).message.props
      .choice;
    kept.prune = true;

    expect(kept).not.toBe(shared);
    expect(shared.prune).toBe(false);
  });

  it("keeps a function prop as it is, so a callback reaches the caller", () => {
    let prune = false;
    const onPrune = (value: boolean) => {
      prune = value;
    };
    const box = observable.box<unknown>();

    box.set({ message: createElement("div", { onPrune }) });

    (
      box.get() as { message: { props: { onPrune: (value: boolean) => void } } }
    ).message.props.onPrune(true);

    expect(prune).toBe(true);
  });
});
