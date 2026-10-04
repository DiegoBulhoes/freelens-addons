import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import { describeCount, nextSort, type Sort, searchRows, sortRows } from "../api/table";
import { NamespaceFilter } from "./namespace-filter";
import { type SelectionAction, SelectionBar } from "./selection-bar";
import { ArgoCDStyles } from "./styles";

const {
  Component: { Checkbox, MenuActions },
} = Renderer;

export interface Column<Row> {
  title: string;
  className?: "ArgoCD-table__shrink" | "ArgoCD-table__fill" | "ArgoCD-table__number";
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
}

export interface ListPageProps<Row> {
  title: string;
  subline?: ReactNode;
  alarm?: string;
  note?: string;
  /** `data-section`; the e2e suite finds the list by it. */
  section?: string;
  rows: Row[];
  columns: Column<Row>[];
  keyOf: (row: Row) => string;
  searchTexts: (row: Row) => string[];
  /** Call it from a click that has had preventDefault, or the drawer closes at once. */
  onOpen?: (row: Row) => void;
  menu?: (row: Row) => ReactNode;
  empty: string;
  initialQuery?: string;
  filters?: ReactNode;
  /** Ticks rows and offers these actions on them. */
  selection?: { hint: string; actions: SelectionAction<Row>[] };
  /** The drawer, rendered beside the table so it overlays the page. */
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
  // A row searched away or deleted drops out of the selection.
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
    <div className="ArgoCD ArgoCD-page ArgoCD-page--list">
      <ArgoCDStyles />
      <div className="ArgoCD-page__head">
        <div>
          <h1 className="ArgoCD-page__headline">
            {props.title}{" "}
            <span className="ArgoCD-page__count">{describeCount(shown.length, rows.length)}</span>
          </h1>
          {props.alarm && (
            <p className="ArgoCD-page__subline ArgoCD-page__subline--alarm">{props.alarm}</p>
          )}
          {props.note && <p className="ArgoCD-page__subline">{props.note}</p>}
          {props.subline && <p className="ArgoCD-page__subline">{props.subline}</p>}
        </div>
        <div className="ArgoCD-page__actions">
          <input
            type="search"
            className="ArgoCD-search"
            placeholder="Search…"
            aria-label={`Search ${props.title}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <NamespaceFilter />
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

      <section className="ArgoCD-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="ArgoCD-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="ArgoCD-table">
            <thead>
              <tr>
                {props.selection && (
                  <th className="ArgoCD-table__check">
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
                        className="ArgoCD-sort"
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
              {shown.map((row) => {
                const items = props.menu?.(row);
                const key = props.keyOf(row);

                return (
                  <tr
                    key={key}
                    className={
                      [
                        props.onOpen ? "ArgoCD-table__row--clickable" : "",
                        ticked.has(key) ? "ArgoCD-table__row--selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    // Prevented, or the drawer's outside-click listener closes it as it opens.
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
                        className="ArgoCD-table__check"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          aria-label={`Select ${key}`}
                          value={ticked.has(key)}
                          onChange={(on: boolean) => toggle([key], on)}
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
                        className="ArgoCD-table__actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {items && (
                          <MenuActions toolbar={false} autoCloseOnSelect>
                            {items}
                          </MenuActions>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {props.children}
    </div>
  );
}

// `observer` drops the type parameter; without this cast `Row` becomes `unknown`.
export const ListPage = observer(ListPageView) as <Row>(props: ListPageProps<Row>) => JSX.Element;
