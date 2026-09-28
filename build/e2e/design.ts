import type { Session } from "./cdp";

/**
 * What the design standard promises, checked on whatever page is open.
 *
 * The standard is one stylesheet every extension carries a copy of
 * (`scripts/sync-design.sh --check` keeps the copies identical). That alone
 * cannot say a page uses it: a component written with its own class, or one
 * renamed and left behind, renders in the browser's defaults beside
 * neighbours that follow the standard — the very difference it exists to
 * remove. So this reads the page itself:
 *
 * - every box-like component sits on the host's surface grey, in either theme;
 * - every pressable component that is a <button> is aligned left, not centred;
 * - a table's header is the host's table header colour, as in its own lists;
 * - a pressed filter carries the accent;
 * - every class the extension puts on the page has a rule somewhere. A class
 *   no stylesheet mentions is either a typo or a component that was renamed
 *   and not moved over.
 *
 * Modifiers (`--`) are exempt from the last check: a state with no colour of
 * its own is meant to look like the default.
 *
 * Returns the violations, one line each; an empty list is a page that follows
 * the standard.
 */
export async function designViolations(
  session: Session,
  contextId: number,
  prefix: string,
): Promise<string[]> {
  return session.evaluate<string[]>(
    `(() => {
      const P = ${JSON.stringify(`${prefix}-`)};
      const resolve = (variable) => {
        const probe = document.createElement("span");
        probe.style.color = "var(" + variable + ")";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };
      const surface = resolve("--sidebarBackground");
      const accent = resolve("--colorInfo");
      const all = (selector) => [...document.querySelectorAll(selector)];
      const problems = new Set();

      // Xvfb's pointer rests at the centre of the screen, so whatever is there
      // reads its hover colour; the synthetic events these tests send never
      // move the real one.
      for (const kind of ["card", "row", "box", "table", "facts", "banner"]) {
        for (const element of all("." + P + kind)) {
          if (element.matches(":hover")) continue;
          const background = getComputedStyle(element).backgroundColor;
          if (background !== surface) {
            problems.add("." + P + kind + " sits on " + background + ", not the surface " + surface);
          }
        }
      }

      for (const selector of [
        "button." + P + "card",
        "button." + P + "row",
        "button." + P + "row__main",
        "button." + P + "box",
        "button." + P + "box__head",
        "button." + P + "chip",
        "." + P + "picker__item",
      ]) {
        for (const element of all(selector)) {
          const alignment = getComputedStyle(element).textAlign;
          if (!/^(left|start)$/.test(alignment)) problems.add(selector + " is aligned " + alignment);
        }
      }

      // A table's header reads like the host's lists beside it, not a label of ours.
      const header = resolve("--tableHeaderColor");
      for (const element of all("." + P + "table th")) {
        const colour = getComputedStyle(element).color;
        if (colour !== header) problems.add("a ." + P + "table header is " + colour + ", not the host's " + header);
      }

      for (const element of all("." + P + 'filter[aria-pressed="true"]')) {
        const background = getComputedStyle(element).backgroundColor;
        if (background !== accent) {
          problems.add("a pressed ." + P + "filter is " + background + ", not the accent " + accent);
        }
      }

      const selectors = [...document.styleSheets]
        .flatMap((sheet) => {
          try {
            return [...sheet.cssRules];
          } catch {
            return [];
          }
        })
        .map((rule) => rule.selectorText ?? "")
        .join(" ");
      const defined = new Set(
        (selectors.match(/\\.[A-Za-z_][\\w-]*/g) ?? []).map((token) => token.slice(1)),
      );

      for (const element of all('[class*="' + P + '"]')) {
        for (const name of element.classList) {
          if (name.startsWith(P) && !name.includes("--") && !defined.has(name)) {
            problems.add("." + name + " is used and no stylesheet has a rule for it");
          }
        }
      }

      return [...problems];
    })()`,
    contextId,
  );
}
