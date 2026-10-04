---
title: "Design standard"
description: "How every extension page is structured and drawn"
---

# Design standard

Every extension looks like one product, and like Freelens. Components are in
`templates/src/renderer/styles/design.css`; `P` below is the extension's prefix.

## Contents

- [Rules](#rules)
- [Navigation](#navigation)
- [Pages](#pages)
- [Tables](#tables)
- [Drawers](#drawers)
- [Dialogs](#dialogs)
- [Text](#text)
- [Host pages](#host-pages)
- [Verifying](#verifying)

## Rules

- Before drawing anything, look at how the repository's other extensions and the host's own lists draw it, and match them. A difference is a bug.
- Use the host's components (`Checkbox`, `MenuActions`, `Drawer`, `ConfirmDialog`), not native elements.
- Colours are host tokens only.
- Surfaces: `--sidebarBackground`; hover `--sidebarItemHoverBackground`.
- Tones (`--colorError`, `--colorWarning`, `--colorInfo`, `--colorSuccess`) are edges or marks, never backgrounds.
- Pressable means `<button>`, left-aligned.
- State lives in `aria-pressed`, `aria-expanded`, `disabled`.
- Never restyle a component in an extension. Change `design.css`, then run `scripts/sync-design.sh`.

## Navigation

- One sidebar group per extension, shown only with its CRDs. Overview first.
- A feature with more than one screen is a sub-group, shown only with its CRD.
- One job per page. No tabs of ours.
- Every row and card opens something. A row in a list opens that object's drawer; a card or an overview row may open the list behind it.

## Pages

| Type | Built from |
|------|------------|
| Overview | `P-page`: head, `P-cards`, `P-list` of rows needing attention |
| List page | `P-page P-page--list`: head, one `P-table`. Use `list-page.tsx` |
| Picker | `P-picker`: pick left, read right |
| Host list | `KubeObjectListLayout` |

Head (`P-page__head`): a headline with the count that matters, then search, the host's namespace
selector (`namespace-filter.tsx`), and one action.

| Shows | Component |
|-------|-----------|
| A number to act on | `P-card` (`stat-card.tsx`) |
| An object, its state and reason | `P-row` |
| An object and its children | `P-box` with `P-chips` |
| Many objects by column | `P-table` |
| Name/value pairs | `P-facts` |
| What the page must say first | `P-banner` |
| A state | `P-status` (`status.tsx`) |

## Tables

- Look of the host's lists: `--contentColor` panel, `--tableHeaderBackground` header, rows 33px apart, no lines.
- Cells hold text and `P-link` only. Kind or type is plain text.
- Cell classes: `__shrink` (names), `__fill` (the truncating column), `__number`, `__actions` (⋮ menu).
- Search in the head; sort by header (`aria-sort`). Both from `api/table.ts`.
- Row click opens the object's drawer: a fuller view than the row, never a jump to another page, a side pane, or nothing. A link in a cell (a cluster, an owner) stops the click and navigates.
- Lists with writes tick rows: the first cell holds the host's `Checkbox`, and the selection bar offers the bulk actions, each confirmed by typing `confirm` and listing what it skips and why.

## Drawers

- From a host list: the host's details drawer (`kubeObjectDetailItems`).
- From our pages: `object-drawer.tsx`. Actions in the title bar through the host's toolbar `MenuActions`, as its own drawers do; destructive last.
- What the drawer holds: the state with its cause in a banner, the facts, what belongs to the object (its runs, its instances, its children), commands to copy. More than the row, never a copy of it.
- The opening click calls `preventDefault()`, or the drawer closes at once. Also on another page, when it navigates to a route that opens a drawer.
- So does a menu item inside a drawer: the menu renders outside it, so its click counts as outside.

## Dialogs

Every write asks first (`confirm.tsx`). Message root: `P P-dialog`.

- OK label: verb and count ("Delete", "Restore 2").
- Options off by default; a risky one shows its warning when ticked.
- Form values reach `ok` through callbacks.
- Type the object's name for a delete, or an option that deletes or recreates.
- Type `confirm` for a write to several objects. Nothing for writes that change nothing.
- After: a past-tense notification, with Undo when the reverse is one write.
- Bulk on a host list: `selection-bar.tsx` in `renderFooter`.

## Text

- Labels are verbs, never "...".
- Every button and menu item has a tooltip saying its effect.
- Sentence case. Relative times in tables, absolute in facts.
- Empty states say what is empty and why.

## Host pages

- Mount `<PStyles />` beside a `KubeObjectListLayout` and inside a details drawer item.
- Give the layout its own class, never `P`.

## Verifying

- `sync-design.sh --check <dir>`: no stale copy.
- `designViolations()` on every page; `dialogColourViolations()` with each dialog open (`harness/design.ts`).
- Both themes (Preferences → App → Theme): pages, drawers, dialogs.
