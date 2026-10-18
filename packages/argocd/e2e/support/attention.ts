import type { Session } from "../../../../build/e2e/cdp";
import { countOf, openMenu, pressChip, waitFor } from "../../../../build/e2e/freelens";

export const ATTENTION_ROWS = '[data-section="attention"] .ArgoCD-row';

/** Puts the attention list on All (the filter persists across runs) and returns its row count. */
export async function showAllAttention(session: Session, frame: number): Promise<number> {
  await waitFor(
    "the attention filters",
    async () => (await countOf(session, frame, ".ArgoCD-filter")) > 0 || undefined,
  );
  await pressChip(session, frame, ".ArgoCD-filter", "All");

  return waitFor("the attention list", async () => {
    const rows = await countOf(session, frame, ATTENTION_ROWS);

    return rows > 0 ? rows : undefined;
  });
}

/** The names on the attention list's rows that show a pin. */
export function pinnedNames(session: Session, frame: number): Promise<string[]> {
  return session.evaluate<string[]>(
    `[...document.querySelectorAll(${JSON.stringify(ATTENTION_ROWS)})]
       .filter((row) => row.querySelector('.ArgoCD-row__pin'))
       .map((row) => row.querySelector('.ArgoCD-row__name b')?.textContent.trim() ?? '')`,
    frame,
  );
}

/** Opens that row's menu and presses `item`; false when the row or the item is not there. */
export async function pressRowMenu(
  session: Session,
  frame: number,
  name: string,
  item: string,
): Promise<boolean> {
  const opened = await session.evaluate<boolean>(
    `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(ATTENTION_ROWS)})]
        .find((each) => each.querySelector('.ArgoCD-row__name b')?.textContent.trim() === ${JSON.stringify(name)});
      const kebab = row?.querySelector('.ArgoCD-row__actions i.Icon');
      kebab?.click();
      return Boolean(kebab);
    })()`,
    frame,
  );

  if (!opened) return false;
  await openMenu(session, frame);

  return session.evaluate<boolean>(
    `(() => {
      const entry = [...document.querySelectorAll('.MenuItem')]
        .find((each) => each.textContent.includes(${JSON.stringify(item)}));
      if (!entry) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }
      entry.click();
      return true;
    })()`,
    frame,
  );
}

/** Unpins through the row's menu, as a person would, and waits for the pin to go. */
export async function unpin(session: Session, frame: number, name: string): Promise<void> {
  if (!(await pinnedNames(session, frame)).includes(name)) return;
  if (!(await pressRowMenu(session, frame, name, "Unpin"))) {
    throw new Error(`${name}'s menu offers no Unpin`);
  }
  await waitFor(`${name}'s pin to go`, async () =>
    (await pinnedNames(session, frame)).includes(name) ? undefined : true,
  );
}

/** For a finally: a failed unpin is logged, not thrown over the test's own failure. */
export async function unpinQuietly(session: Session, frame: number, name: string): Promise<void> {
  try {
    await unpin(session, frame, name);
  } catch (error) {
    console.log(`  could not unpin ${name}: ${error}`);
  }
}
