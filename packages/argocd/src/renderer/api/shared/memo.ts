export function sameElements<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length && first.every((each, index) => each === second[index]);
}

function sameArgument(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second)) return sameElements(first, second);

  return Object.is(first, second);
}

function sameArguments(first: unknown[], second: unknown[]): boolean {
  return (
    first.length === second.length &&
    first.every((each, index) => sameArgument(each, second[index]))
  );
}

/**
 * Remembers the last answer. An array argument counts as unchanged while it holds the same
 * objects, since the store replaces an object rather than changing it; a copy is kept because the
 * store's own array is mutated in place.
 */
export function rememberLast<Args extends unknown[], Result>(
  compute: (...args: Args) => Result,
): (...args: Args) => Result {
  let last: { args: unknown[]; result: Result } | undefined;

  return (...args: Args) => {
    const previous = last;

    if (previous && sameArguments(previous.args, args)) return previous.result;

    const result = compute(...args);

    last = { args: args.map((each) => (Array.isArray(each) ? [...each] : each)), result };

    return result;
  };
}
