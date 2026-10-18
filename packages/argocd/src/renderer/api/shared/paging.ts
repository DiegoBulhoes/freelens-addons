export interface Page<Item> {
  items: Item[];
  pageIndex: number;
  pageCount: number;
  firstItemNumber: number;
  lastItemNumber: number;
}

export function pageOf<Item>(items: Item[], requestedPage: number, pageSize: number): Page<Item> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const pageIndex = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const start = pageIndex * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    pageIndex,
    pageCount,
    firstItemNumber: items.length === 0 ? 0 : start + 1,
    lastItemNumber: Math.min(start + pageSize, items.length),
  };
}
