import { type ReactNode, useState } from "react";

import { nextSort, type Sort, sortRows } from "../api/table";

export interface Column<Row> {
  title: string;
  className?: "CertManager-table__shrink" | "CertManager-table__fill" | "CertManager-table__number";
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
}

export interface TableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  keyOf: (row: Row) => string;
  onOpen?: (row: Row) => void;
  openTitle?: (row: Row) => string;
  stateOf?: (row: Row) => string;
}

export function Table<Row>({ rows, columns, keyOf, onOpen, openTitle, stateOf }: TableProps<Row>) {
  const [sort, setSort] = useState<Sort>();

  const shown = sortRows(rows, sort, (row, column) =>
    columns.find((each) => each.title === column)?.sortValue?.(row),
  );

  return (
    <table className="CertManager-table">
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
        {shown.map((row) => (
          <tr
            key={keyOf(row)}
            className={onOpen ? "CertManager-table__row--clickable" : undefined}
            title={openTitle?.(row)}
            data-state={stateOf?.(row)}
            onClick={
              onOpen
                ? (event) => {
                    event.preventDefault();
                    onOpen(row);
                  }
                : undefined
            }
          >
            {columns.map((column) => (
              <td key={column.title} className={column.className}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
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
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
