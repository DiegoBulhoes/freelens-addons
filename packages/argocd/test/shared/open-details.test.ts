import { afterEach, describe, expect, it, vi } from "vitest";

import { showDetailsAfterClick } from "../../src/renderer/api/shared/open-details";

describe("opening a drawer from a link", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens it after the click that navigated, so that click cannot close it as outside", async () => {
    const link = document.createElement("button");
    let open = false;

    document.body.append(link);
    link.addEventListener("click", () => {
      showDetailsAfterClick(
        "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/guestbook",
        () => {
          open = true;
        },
      );
    });
    // The host's Drawer listens on window and closes on any click that lands outside it.
    window.addEventListener(
      "click",
      () => {
        open = false;
      },
      { once: true },
    );

    link.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(open).toBe(true);
  });

  it("shows nothing once cancelled, as when the page unmounts first", async () => {
    const show = vi.fn();

    showDetailsAfterClick(
      "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/guestbook",
      show,
    )();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(show).not.toHaveBeenCalled();
  });
});
