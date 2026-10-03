import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { type ReactNode, useState } from "react";

import { describeCount, nextSort, type Sort, searchRows, sortRows } from "../api/table";
import { NamespaceFilter } from "./namespace-filter";
import { TrivyStyles } from "./styles";

const {
  Component: { MenuActions },
} = Renderer;

export interface Column<Row> {
  title: string;
  // `__shrink` for identifiers, `__fill` for the one column that truncates, `__number` for counts.
  className?: "Trivy-table__shrink" | "Trivy-table__fill" | "Trivy-table__number";
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
  // Call it from a click that has had preventDefault.
  onOpen?: (row: Row) => void;
  menu?: (row: Row) => ReactNode;
  empty: string;
  initialQuery?: string;
  filters?: ReactNode;
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
    <div className="Trivy Trivy-page Trivy-page--list">
      <TrivyStyles />
      <div className="Trivy-page__head">
        <div>
          <h1 className="Trivy-page__headline">
            {props.title}{" "}
            <span className="Trivy-page__count">{describeCount(shown.length, rows.length)}</span>
          </h1>
          {props.subline && <p className="Trivy-page__subline">{props.subline}</p>}
        </div>
        <div className="Trivy-page__actions">
          <input
            type="search"
            className="Trivy-search"
            placeholder="Search…"
            aria-label={`Search ${props.title}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <NamespaceFilter />
        </div>
      </div>

      {props.filters}

      <section className="Trivy-section" data-section="list">
        {shown.length === 0 ? (
          <p className="Trivy-section__note">
            {query ? "Nothing matches the search." : props.empty}
          </p>
        ) : (
          <table className="Trivy-table">
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
                        className="Trivy-sort"
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
                  className={props.onOpen ? "Trivy-table__row--clickable" : undefined}
                  // The drawer closes on any unprevented click outside it, which this one would be.
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
                    // A click on the menu must not also open the row.
                    <td
                      className="Trivy-table__actions"
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

// `observer` drops the type parameter; without this, `Row` is inferred as `unknown`.
export const ListPage = observer(ListPageView) as <Row>(props: ListPageProps<Row>) => JSX.Element;
