// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { keepDrawerOpen } from "../../src/renderer/api/shared/drawer-click";

describe("a click outside any drawer that opens one", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("leaves the drawer it mounts open, though that drawer hears the same click on window", () => {
    const row = document.createElement("button");
    let open = false;

    document.body.append(row);
    row.addEventListener("click", (event) =>
      keepDrawerOpen(event, () => {
        open = true;
        // What the host's Drawer adds on mount: a click not prevented and not inside it closes it.
        window.addEventListener(
          "click",
          (heard) => {
            if (!heard.defaultPrevented) open = false;
          },
          { once: true },
        );
      }),
    );

    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(open).toBe(true);
  });
});
