/** One pressed chip at a time; "All", when shown, clears it. */
export function FilterChips<Filter extends string>({
  filters,
  labels,
  titles,
  counts,
  current,
  onChange,
  all = true,
  section,
}: {
  filters: readonly Filter[];
  labels: Record<Filter, string>;
  titles: Record<Filter, string>;
  counts?: Record<Filter, number>;
  current: Filter | undefined;
  onChange: (filter: Filter | undefined) => void;
  all?: boolean;
  section?: string;
}) {
  return (
    <div className="Prometheus-filters" data-section={section}>
      {all && (
        <button
          type="button"
          className="Prometheus-filter"
          aria-pressed={current === undefined}
          title="Shows every row"
          onClick={() => onChange(undefined)}
        >
          All
        </button>
      )}
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          className="Prometheus-filter"
          aria-pressed={current === filter}
          title={titles[filter]}
          onClick={() => onChange(filter)}
        >
          {labels[filter]}
          {counts && <span className="Prometheus-filter__count">{counts[filter]}</span>}
        </button>
      ))}
    </div>
  );
}
