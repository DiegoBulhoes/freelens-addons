import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import {
  describeCount,
  limitRows,
  nextSort,
  type Sort,
  searchRows,
  sortRows,
} from "../api/shared/table";
import { NamespaceFilter } from "./namespace-filter";
import { type SelectionAction, SelectionBar } from "./selection-bar";
import { CNPGStyles } from "./styles";

const {
  Component: { Checkbox, MenuActions },
} = Renderer;

export interface Column<Row> {
  title: string;
  className?: "CNPG-table__shrink" | "CNPG-table__fill" | "CNPG-table__number";
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
}

export interface ListPageProps<Row> {
  title: string;
  subline?: ReactNode;
  /** Marks the subline as the page's alarm. */
  alarm?: boolean;
  rows: Row[];
  columns: Column<Row>[];
  keyOf: (row: Row) => string;
  searchTexts: (row: Row) => string[];
  onOpen?: (row: Row) => void;
  menu?: (row: Row) => ReactNode;
  empty: string;
  /** `data-section`, for an e2e suite to find the list. */
  section?: string;
  /** From route params, as the host's lists read `?search=`. */
  initialQuery?: string;
  filters?: ReactNode;
  /** The page's one action, after the namespace selector. */
  action?: ReactNode;
  /** Ticks rows and offers these actions on them; a cluster write types "confirm". */
  selection?: { hint: string; actions: SelectionAction<Row>[] };
  /** Rows drawn at most; search and sort still run over all of them. */
  limit?: number;
  children?: ReactNode;
}

function ListPageView<Row>(props: ListPageProps<Row>) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [sort, setSort] = useState<Sort>();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const { columns, rows } = props;

  const shown = sortRows(searchRows(rows, query, props.searchTexts), sort, (row, column) =>
    columns.find((each) => each.title === column)?.sortValue?.(row),
  );
  const { drawn, note } = limitRows(shown, props.limit);
  // Only what is on screen counts: a row searched away, past the cap or deleted drops out.
  const selected = drawn.filter((row) => ticked.has(props.keyOf(row)));
  const toggle = (keys: string[], on: boolean) =>
    setTicked((before) => {
      const next = new Set(before);

      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }

      return next;
    });

  return (
    <div className="CNPG CNPG-page CNPG-page--list">
      <CNPGStyles />
      <div className="CNPG-page__head">
        <div>
          <h1 className="CNPG-page__headline">
            {props.title}{" "}
            <span className="CNPG-page__count">{describeCount(shown.length, rows.length)}</span>
          </h1>
          {props.subline && (
            <p className={`CNPG-page__subline${props.alarm ? " CNPG-page__subline--alarm" : ""}`}>
              {props.subline}
            </p>
          )}
        </div>
        <div className="CNPG-page__actions">
          <input
            type="search"
            className="CNPG-search"
            placeholder="Search…"
            aria-label={`Search ${props.title}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <NamespaceFilter />
          {props.action}
        </div>
      </div>

      {props.filters}

      {props.selection && (
        <SelectionBar
          getItems={() => drawn}
          pickOnlySelected={() => selected}
          hint={props.selection.hint}
          actions={props.selection.actions}
        />
      )}

      <section className="CNPG-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="CNPG-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="CNPG-table">
            <thead>
              <tr>
                {props.selection && (
                  <th className="CNPG-table__check">
                    <Checkbox
                      aria-label="Select every row shown"
                      value={selected.length > 0 && selected.length === drawn.length}
                      onChange={(on: boolean) => toggle(drawn.map(props.keyOf), on)}
                    />
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.title}
                    aria-sort={
                      column.sortValue
                        ? sort?.column === column.title
                          ? sort.direction
                          : "none"
                        : undefined
                    }
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className="CNPG-sort"
                        title={`Sort by ${column.title.toLowerCase()}`}
                        onClick={() => setSort(nextSort(sort, column.title))}
                      >
                        {column.title}
                      </button>
                    ) : (
                      column.title
                    )}
                  </th>
                ))}
                {props.menu && <th />}
              </tr>
            </thead>
            <tbody>
              {drawn.map((row) => (
                <tr
                  key={props.keyOf(row)}
                  className={
                    [
                      props.onOpen ? "CNPG-table__row--clickable" : "",
                      ticked.has(props.keyOf(row)) ? "CNPG-table__row--selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  // Unprevented, this click reaches the drawer's outside-click listener and closes it.
                  onClick={
                    props.onOpen
                      ? (event) => {
                          event.preventDefault();
                          props.onOpen?.(row);
                        }
                      : undefined
                  }
                >
                  {props.selection && (
                    <td
                      className="CNPG-table__check"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={`Select ${props.keyOf(row)}`}
                        value={ticked.has(props.keyOf(row))}
                        onChange={(on: boolean) => toggle([props.keyOf(row)], on)}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.title} className={column.className}>
                      {column.cell(row)}
                    </td>
                  ))}
                  {props.menu && (
                    <td
                      className="CNPG-table__actions"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <MenuActions toolbar={false} autoCloseOnSelect>
                        {props.menu(row)}
                      </MenuActions>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {note && (
          <p className="CNPG-section__note" data-section="list-limit">
            {note}
          </p>
        )}
      </section>

      {props.children}
    </div>
  );
}

// `observer` drops the type parameter; without the cast, `Row` is `unknown`.
export const ListPage = observer(ListPageView) as <Row>(props: ListPageProps<Row>) => JSX.Element;
