// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { keepDrawerOpen } from "../../src/renderer/api/shared/drawer-click";

describe("a click that unmounts its own control inside a drawer", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("leaves the drawer open, though its target is gone by the time the drawer hears it", () => {
    const drawer = document.createElement("div");
    const button = document.createElement("button");
    let open = true;

    drawer.className = "Drawer";
    drawer.append(button);
    document.body.append(drawer);
    button.addEventListener("click", (event) => keepDrawerOpen(event, () => button.remove()));
    // What the host's Drawer does on window: a prevented click, or one inside any drawer, is not outside.
    window.addEventListener(
      "click",
      (event) => {
        if (event.defaultPrevented || (event.target as Element).closest(".Drawer")) return;
        open = false;
      },
      { once: true },
    );

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(button.isConnected).toBe(false);
    expect(open).toBe(true);
  });
});
