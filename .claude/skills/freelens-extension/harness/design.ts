import type { Session } from "./cdp";

// Design-standard violations on the open page. Modifiers (`--`) may lack a rule of their own.
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

      // Xvfb's pointer rests at the screen centre and synthetic events never move it.
      for (const kind of ["card", "row", "box", "facts", "banner"]) {
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

      const panel = resolve("--contentColor");
      const band = resolve("--tableHeaderBackground");
      for (const page of all("." + P + "page--list")) {
        const background = getComputedStyle(page).backgroundColor;
        if (background !== panel) problems.add("a ." + P + "page--list sits on " + background + ", not the host's list panel " + panel);
      }
      for (const table of all("." + P + "table")) {
        const background = getComputedStyle(table).backgroundColor;
        if (background !== panel) problems.add("a ." + P + "table sits on " + background + ", not the host's list panel " + panel);
      }
      for (const cell of all("." + P + "table th")) {
        const background = getComputedStyle(cell).backgroundColor;
        if (background !== band) problems.add("a ." + P + "table header band is " + background + ", not the host's " + band);
      }
      for (const row of all("." + P + "table tr")) {
        const height = row.getBoundingClientRect().height;
        if (Math.abs(height - 33) > 0.5) problems.add("a ." + P + "table row is " + height + "px; the host's lists place theirs every 33px");
      }
      for (const cell of all("." + P + "table td")) {
        if (getComputedStyle(cell).borderBottomStyle !== "none") problems.add("a ." + P + "table row has a line under it; the host's lists have none");
      }

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

// The host's ConfirmDialog is white in every theme; ours must take the theme's surface and text.
export async function dialogColourViolations(
  session: Session,
  contextId: number,
  prefix: string,
): Promise<string[]> {
  return session.evaluate<string[]>(
    `(() => {
      const P = ${JSON.stringify(prefix)};
      const dialog = document.querySelector(".ConfirmDialog");
      if (!dialog) return ["no dialog is open"];
      const root = dialog.querySelector("." + P + "-dialog");
      if (!root) return ["the dialog's message has no ." + P + "-dialog"];
      const resolve = (variable) => {
        const probe = document.createElement("span");
        probe.style.color = "var(" + variable + ")";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };
      const problems = [];
      const panel = getComputedStyle(dialog.querySelector(".box")).backgroundColor;
      const surface = resolve("--contentColor").replace("rgb(", "rgba(").replace(")", ", 1)");
      const opaque = (colour) => colour.startsWith("rgba") ? colour : colour.replace("rgb(", "rgba(").replace(")", ", 1)");
      if (opaque(panel) !== surface) problems.push("the dialog's panel is " + panel + ", the theme's surface is " + resolve("--contentColor"));
      const expected = getComputedStyle(root.parentElement).color;
      const exempt = (element) =>
        element.matches('[aria-pressed="true"]') ||
        [...element.classList].some((name) => name.startsWith(P + "-text--") || name.startsWith(P + "-tag"));
      return [root, ...root.querySelectorAll("p, span, label, input, button")]
        .filter((element) => element.textContent.trim() || element.matches("input"))
        .filter((element) => !exempt(element) && !element.closest('[aria-pressed="true"]'))
        .filter((element) => getComputedStyle(element).color !== expected)
        .map((element) => (element.className || element.tagName) + " is " + getComputedStyle(element).color + ", the dialog's text is " + expected)
        .concat(problems);
    })()`,
    contextId,
  );
}
