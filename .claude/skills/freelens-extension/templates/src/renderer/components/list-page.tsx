import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import { describeCount, nextSort, type Sort, searchRows, sortRows } from "../api/table";
import { NamespaceFilter } from "./namespace-filter";
import { type SelectionAction, SelectionBar } from "./selection-bar";
import { __Name__Styles } from "./styles";

const {
  Component: { Checkbox, MenuActions },
} = Renderer;

export interface Column<Row> {
  title: string;
  className?: "__Name__-table__shrink" | "__Name__-table__fill" | "__Name__-table__number";
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
}

export interface ListPageProps<Row> {
  title: string;
  subline?: ReactNode;
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
  // Only what is on screen counts: a row searched away or deleted drops out of the selection.
  const selected = shown.filter((row) => ticked.has(props.keyOf(row)));
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
    <div className="__Name__ __Name__-page __Name__-page--list">
      <__Name__Styles />
      <div className="__Name__-page__head">
        <div>
          <h1 className="__Name__-page__headline">
            {props.title}{" "}
            <span className="__Name__-page__count">{describeCount(shown.length, rows.length)}</span>
          </h1>
          {props.subline && <p className="__Name__-page__subline">{props.subline}</p>}
        </div>
        <div className="__Name__-page__actions">
          <input
            type="search"
            className="__Name__-search"
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
          getItems={() => shown}
          pickOnlySelected={() => selected}
          hint={props.selection.hint}
          actions={props.selection.actions}
        />
      )}

      <section className="__Name__-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="__Name__-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="__Name__-table">
            <thead>
              <tr>
                {props.selection && (
                  <th className="__Name__-table__check">
                    <Checkbox
                      aria-label="Select every row shown"
                      value={selected.length > 0 && selected.length === shown.length}
                      onChange={(on: boolean) => toggle(shown.map(props.keyOf), on)}
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
                        className="__Name__-sort"
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
              {shown.map((row) => (
                <tr
                  key={props.keyOf(row)}
                  className={
                    [
                      props.onOpen ? "__Name__-table__row--clickable" : "",
                      ticked.has(props.keyOf(row)) ? "__Name__-table__row--selected" : "",
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
                      className="__Name__-table__check"
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
                      className="__Name__-table__actions"
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
      </section>

      {props.children}
    </div>
  );
}

// `observer` drops the type parameter; without the cast, `Row` is `unknown`.
export const ListPage = observer(ListPageView) as <Row>(props: ListPageProps<Row>) => JSX.Element;
