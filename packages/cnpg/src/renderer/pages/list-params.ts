/** The route params every list page reads; see LIST_PARAMS in index.tsx. */
export interface ListParams {
  kind?: { get(): string };
  namespace?: { get(): string };
  name?: { get(): string };
  cluster?: { get(): string };
  filter?: { get(): string };
}
