import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import type { LiveState } from "../api/shared/live-reads";
import {
  describeCount,
  limitRows,
  nextSort,
  type Sort,
  searchRows,
  sortRows,
} from "../api/shared/table";
import { NamespaceFilter } from "./namespace-filter";
import { PrometheusStyles } from "./styles";

const {
  Component: { MenuActions },
} = Renderer;

export interface Column<Row> {
  title: string;
  className?: "Prometheus-table__shrink" | "Prometheus-table__fill" | "Prometheus-table__number";
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
  action?: ReactNode;
  /** False for cluster-scoped rows, which no namespace narrows. */
  namespaced?: boolean;
  above?: ReactNode;
  /** Rows drawn at most; search and sort still run over all of them. */
  limit?: number;
  /** As `data-live`, for an e2e suite to wait for the live reads. */
  live?: LiveState;
  children?: ReactNode;
}

function ListPageView<Row>(props: ListPageProps<Row>) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [sort, setSort] = useState<Sort>();
  const { columns, rows } = props;

  const shown = sortRows(searchRows(rows, query, props.searchTexts), sort, (row, column) =>
    columns.find((each) => each.title === column)?.sortValue?.(row),
  );
  const { drawn, note } = limitRows(shown, props.limit);

  return (
    <div className="Prometheus Prometheus-page Prometheus-page--list" data-live={props.live}>
      <PrometheusStyles />
      <div className="Prometheus-page__head">
        <div>
          <h1 className="Prometheus-page__headline">
            {props.title}{" "}
            <span className="Prometheus-page__count">
              {describeCount(shown.length, rows.length)}
            </span>
          </h1>
          {props.subline && <p className="Prometheus-page__subline">{props.subline}</p>}
        </div>
        <div className="Prometheus-page__actions">
          <input
            type="search"
            className="Prometheus-search"
            placeholder="Search…"
            aria-label={`Search ${props.title}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {props.namespaced !== false && <NamespaceFilter />}
          {props.action}
        </div>
      </div>

      {props.filters}

      {props.above}

      <section className="Prometheus-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="Prometheus-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="Prometheus-table">
            <thead>
              <tr>
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
                        className="Prometheus-sort"
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
                  className={props.onOpen ? "Prometheus-table__row--clickable" : undefined}
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
                  {columns.map((column) => (
                    <td key={column.title} className={column.className}>
                      {column.cell(row)}
                    </td>
                  ))}
                  {props.menu && (
                    <td
                      className="Prometheus-table__actions"
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
          <p className="Prometheus-section__note" data-section="list-limit">
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
