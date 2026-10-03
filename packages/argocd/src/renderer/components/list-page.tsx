import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import { describeCount, nextSort, type Sort, searchRows, sortRows } from "../api/table";
import { NamespaceFilter } from "./namespace-filter";
import { ArgoCDStyles } from "./styles";

const {
  Component: { MenuActions },
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
  /** The drawer, rendered beside the table so it overlays the page. */
  children?: ReactNode;
}

function ListPageView<Row>(props: ListPageProps<Row>) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [sort, setSort] = useState<Sort>();
  const { columns, rows } = props;

  const shown = sortRows(searchRows(rows, query, props.searchTexts), sort, (row, column) =>
    columns.find((each) => each.title === column)?.sortValue?.(row),
  );

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

      <section className="ArgoCD-section" data-section={props.section ?? "list"}>
        {shown.length === 0 ? (
          <p className="ArgoCD-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="ArgoCD-table">
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

                return (
                  <tr
                    key={props.keyOf(row)}
                    className={props.onOpen ? "ArgoCD-table__row--clickable" : undefined}
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
