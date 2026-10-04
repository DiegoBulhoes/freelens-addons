import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useState } from "react";

import { nextSort, type Sort, sortRows } from "../api/table";

const {
  Component: { Checkbox },
} = Renderer;

export interface Column<Row> {
  title: string;
  className?: "CertManager-table__shrink" | "CertManager-table__fill" | "CertManager-table__number";
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
}

export interface TableSelection {
  ticked: ReadonlySet<string>;
  toggle: (keys: string[], on: boolean) => void;
}

export interface TableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  keyOf: (row: Row) => string;
  onOpen?: (row: Row) => void;
  openTitle?: (row: Row) => string;
  stateOf?: (row: Row) => string;
  selection?: TableSelection;
}

export function Table<Row>({
  rows,
  columns,
  keyOf,
  onOpen,
  openTitle,
  stateOf,
  selection,
}: TableProps<Row>) {
  const [sort, setSort] = useState<Sort>();

  const shown = sortRows(rows, sort, (row, column) =>
    columns.find((each) => each.title === column)?.sortValue?.(row),
  );
  const tickedShown = selection ? shown.filter((row) => selection.ticked.has(keyOf(row))) : [];

  return (
    <table className="CertManager-table">
      <thead>
        <tr>
          {selection && (
            <th className="CertManager-table__check">
              <Checkbox
                aria-label="Select every row shown"
                value={tickedShown.length > 0 && tickedShown.length === shown.length}
                onChange={(on: boolean) => selection.toggle(shown.map(keyOf), on)}
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
                  className="CertManager-sort"
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
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => {
          const key = keyOf(row);

          return (
            <tr
              key={key}
              className={
                [
                  onOpen ? "CertManager-table__row--clickable" : "",
                  selection?.ticked.has(key) ? "CertManager-table__row--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              title={openTitle?.(row)}
              data-state={stateOf?.(row)}
              // Unprevented, this click reaches the drawer's outside-click listener and closes it.
              onClick={
                onOpen
                  ? (event) => {
                      event.preventDefault();
                      onOpen(row);
                    }
                  : undefined
              }
            >
              {selection && (
                <td
                  className="CertManager-table__check"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    aria-label={`Select ${key}`}
                    value={selection.ticked.has(key)}
                    onChange={(on: boolean) => selection.toggle([key], on)}
                  />
                </td>
              )}
              {columns.map((column) => (
                <td key={column.title} className={column.className}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CellLink({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="CertManager-link"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
