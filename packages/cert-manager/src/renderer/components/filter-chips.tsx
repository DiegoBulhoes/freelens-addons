/** One pressed chip at a time; the first key is the list unfiltered. */
export function FilterChips<Filter extends string>({
  labels,
  titles,
  current,
  onChange,
  section,
}: {
  labels: Record<Filter, string>;
  titles: Record<Filter, string>;
  current: Filter;
  onChange: (filter: Filter) => void;
  section?: string;
}) {
  return (
    <div className="CertManager-filters" data-section={section}>
      {(Object.keys(labels) as Filter[]).map((key) => (
        <button
          key={key}
          type="button"
          className="CertManager-filter"
          aria-pressed={current === key}
          title={titles[key]}
          onClick={() => onChange(key)}
        >
          {labels[key]}
        </button>
      ))}
    </div>
  );
}
