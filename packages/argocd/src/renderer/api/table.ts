export type SortDirection = "ascending" | "descending";

export interface Sort {
  column: string;
  direction: SortDirection;
}

export function searchRows<Row>(
  rows: Row[],
  query: string,
  textsOf: (row: Row) => string[],
): Row[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 0) return rows;

  return rows.filter((row) => {
    const haystack = textsOf(row).join(" ").toLowerCase();

    return words.every((word) => haystack.includes(word));
  });
}

export function sortRows<Row>(
  rows: Row[],
  sort: Sort | undefined,
  valueAt: (row: Row, column: string) => string | number | undefined,
): Row[] {
  if (!sort) return rows;

  const factor = sort.direction === "ascending" ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, value: valueAt(row, sort.column) }))
    .sort((first, second) => {
      // Empty values go last in either direction, so they are placed before the direction applies.
      if (first.value === undefined || second.value === undefined) {
        const empties = Number(first.value === undefined) - Number(second.value === undefined);

        return empties === 0 ? first.index - second.index : empties;
      }

      const order = compare(first.value, second.value) * factor;

      return order === 0 ? first.index - second.index : order;
    })
    .map(({ row }) => row);
}

function compare(first: string | number, second: string | number): number {
  if (typeof first === "number" && typeof second === "number") return first - second;

  return String(first).localeCompare(String(second), undefined, { numeric: true });
}

export function nextSort(current: Sort | undefined, column: string): Sort | undefined {
  if (current?.column !== column) return { column, direction: "ascending" };
  if (current.direction === "ascending") return { column, direction: "descending" };

  return undefined;
}

export function describeCount(shown: number, total: number): string {
  const noun = total === 1 ? "item" : "items";

  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
