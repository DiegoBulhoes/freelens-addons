import { FILTER_LABELS, FILTER_TITLES, type RowFilter } from "../api/objects/rows";

export function RowFilters({
  filters,
  current,
  onChange,
}: {
  filters: RowFilter[];
  current: RowFilter;
  onChange: (filter: RowFilter) => void;
}) {
  return (
    <div className="Redis-filters">
      {filters.map((key) => (
        <button
          key={key}
          type="button"
          className="Redis-filter"
          aria-pressed={current === key}
          title={FILTER_TITLES[key]}
          onClick={() => onChange(key)}
        >
          {FILTER_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
