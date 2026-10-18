/** One pressed chip at a time; "All" clears it. */
export function FilterChips<Filter extends string>({
  filters,
  labels,
  titles,
  counts,
  current,
  onChange,
  section,
}: {
  filters: readonly Filter[];
  labels: Record<Filter, string>;
  titles: Record<Filter, string>;
  counts?: Record<Filter, number>;
  current: Filter | undefined;
  onChange: (filter: Filter | undefined) => void;
  section?: string;
}) {
  return (
    <div className="CNPG-filters" data-section={section}>
      <button
        type="button"
        className="CNPG-filter"
        aria-pressed={current === undefined}
        title="Shows every row"
        onClick={() => onChange(undefined)}
      >
        All
      </button>
      {filters.map((filter) => (
        <button
          key={filter}
          type="button"
          className="CNPG-filter"
          aria-pressed={current === filter}
          title={titles[filter]}
          onClick={() => onChange(filter)}
        >
          {labels[filter]}
          {counts && <span className="CNPG-filter__count">{counts[filter]}</span>}
        </button>
      ))}
    </div>
  );
}
