import { afterEach, describe, expect, it } from "vitest";

import { idOf } from "../src/renderer/api/identity";
import {
  hydrate,
  onStateChange,
  readState,
  snapshot,
  writeState,
} from "../src/renderer/api/local-state";
import { isPinned, listPins, setPinned, togglePin } from "../src/renderer/api/pins";
import { readPreferences, writePreference } from "../src/renderer/api/preferences";
import { application } from "./fixtures";

afterEach(() => {
  hydrate({});
});

describe("remembering an operator's working state", () => {
  it("round-trips a value", () => {
    writeState("mark", { a: 1 });

    expect(readState("mark", null)).toEqual({ a: 1 });
  });

  it("pins and unpins, reporting the state it ended in", () => {
    const id = idOf(application("guestbook"));

    expect(togglePin(id)).toBe(true);
    expect(isPinned(id)).toBe(true);
    expect(listPins()).toEqual([id]);

    expect(togglePin(id)).toBe(false);
    expect(isPinned(id)).toBe(false);
  });

  it("sets a pin either way, for the Undo of a pin or an unpin", () => {
    const first = idOf(application("guestbook"));
    const second = idOf(application("podinfo"));

    setPinned(first, true);
    setPinned(second, true);
    setPinned(first, true);

    expect(listPins()).toEqual([first, second]);

    setPinned(first, false);
    setPinned(first, false);

    expect(listPins()).toEqual([second]);
  });

  it("remembers one preference without dropping the others", () => {
    writePreference("attentionFilter", "drift");

    expect(readPreferences().attentionFilter).toBe("drift");

    writeState("freelens-addons.argocd.preferences", { attentionFilter: "drift", other: 1 });
    writePreference("attentionFilter", "broken");

    expect(readPreferences()).toEqual({ attentionFilter: "broken", other: 1 });
  });
});

describe("state that was never written", () => {
  it("returns the fallback when nothing has been written", () => {
    expect(readState("missing", "fallback")).toBe("fallback");
    expect(listPins()).toEqual([]);
    expect(readPreferences()).toEqual({});
  });

  it("identifies a cluster-scoped object without a leading undefined", () => {
    expect(idOf({ getName: () => "a-node", getNs: () => undefined })).toBe("/a-node");
  });

  it("identifies an Application the same way everywhere", () => {
    const target = application("guestbook");

    expect(idOf(target)).toBe(`${target.getNs()}/${target.getName()}`);
  });
});

describe("a loaded file that holds rubbish", () => {
  it("ignores stored values that are not the shape each reader expects", () => {
    hydrate({
      "freelens-addons.argocd.pins": "not an array",
      "freelens-addons.argocd.preferences": [],
    });

    expect(listPins()).toEqual([]);
    expect(readPreferences()).toEqual({});
  });

  it("ignores values inside a stored list that are the wrong type", () => {
    writeState("freelens-addons.argocd.pins", ["argocd/keep", 42, null, { id: "x" }]);

    expect(listPins()).toEqual(["argocd/keep"]);
  });

  it("leaves the store empty when what was loaded is not a plain object", () => {
    for (const loaded of ["{oh dear", null, [1, 2], 42]) {
      hydrate(loaded);

      expect(snapshot()).toEqual({});
      expect(listPins()).toEqual([]);
      expect(readPreferences()).toEqual({});
    }
  });
});

describe("the seam the file boundary hangs off", () => {
  it("reports every write, and stops once the listener is disposed", () => {
    let reported = 0;
    const stopReporting = onStateChange(() => {
      reported += 1;
    });

    togglePin("argocd/one");
    writePreference("attentionFilter", "drift");

    expect(reported).toBe(2);

    stopReporting();
    togglePin("argocd/two");

    expect(reported).toBe(2);
  });

  it("does not report a hydrate, so loading a file cannot queue a write of itself", () => {
    let reported = 0;
    const stopReporting = onStateChange(() => {
      reported += 1;
    });

    hydrate({ "freelens-addons.argocd.pins": ["argocd/loaded"] });

    expect(reported).toBe(0);
    expect(listPins()).toEqual(["argocd/loaded"]);

    stopReporting();
  });

  it("hands out a copy, so a snapshot cannot change under the writer holding it", () => {
    writeState("freelens-addons.argocd.pins", ["argocd/keep"]);

    const taken = snapshot();

    taken["freelens-addons.argocd.pins"] = ["argocd/tampered"];

    expect(listPins()).toEqual(["argocd/keep"]);
  });

  it("starts empty, and a write before anything is loaded still reads back", () => {
    expect(snapshot()).toEqual({});

    togglePin("argocd/early");

    expect(isPinned("argocd/early")).toBe(true);
  });
});
