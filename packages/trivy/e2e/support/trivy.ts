import { expect } from "vitest";

import type { Session } from "../../../../build/e2e/cdp";

// A scaled-away ReplicaSet is neither judged nor waiting on a verdict.
export const JUDGED_OR_INACTIVE = ["Scanned", "Scaled away"];

export type CheckLink = { text: string; href: string; target: string };

// The chip's label, without the count it carries.
export const activeChip = (session: Session, frame: number, container: string) =>
  session.evaluate<string>(
    `(() => {
      const on = [...document.querySelectorAll(${JSON.stringify(`${container} button`)})]
        .find((each) => each.getAttribute("aria-pressed") === "true");
      if (!on) return "";
      const label = on.cloneNode(true);
      label.querySelector(".Trivy-filter__count")?.remove();
      return label.textContent.trim();
    })()`,
    frame,
  );

export const chipCount = (session: Session, frame: number, container: string, label: string) =>
  session.evaluate<number>(
    `(() => {
      const chip = [...document.querySelectorAll(${JSON.stringify(`${container} button`)})]
        .find((each) => each.textContent.includes(${JSON.stringify(label)}));
      return Number(chip?.querySelector(".Trivy-filter__count")?.textContent ?? "-1");
    })()`,
    frame,
  );

export const location = (session: Session, frame: number) =>
  session.evaluate<string>("location.pathname + location.search", frame);

export const clickFirst = (session: Session, frame: number, selector: string) =>
  session.evaluate<boolean>(
    `(() => {
      const row = document.querySelector(${JSON.stringify(selector)});
      if (!row) return false;
      row.click();
      return true;
    })()`,
    frame,
  );

export const checkLinks = (session: Session, frame: number, container: string) =>
  session.evaluate<CheckLink[]>(
    `[...document.querySelectorAll(${JSON.stringify(`${container} a[href*="avd.aquasec.com"]`)})]
       .map((each) => ({ text: each.textContent.trim(), href: each.href, target: each.target }))`,
    frame,
  );

export const expectEachToName = (found: CheckLink[]) => {
  expect(found.length, "no check carries a link").toBeGreaterThan(0);

  for (const link of found) {
    expect(link.text).toMatch(/^AVD-[A-Z]+-\d+$/);
    expect(link.href).toBe(`https://avd.aquasec.com/misconfig/${link.text.toLowerCase()}`);
    expect(link.target, "a link that replaces the app's own window").toBe("_blank");
  }
};
