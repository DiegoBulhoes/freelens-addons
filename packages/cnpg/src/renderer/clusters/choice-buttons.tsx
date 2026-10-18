interface ChoiceOption<T> {
  value: T;
  label: string;
  title: string;
}

/** One pressed button among a group, as every Postgres choice in a dialog or drawer is drawn. */
export function ChoiceButtons<T>({
  options,
  value,
  onPick,
}: {
  options: ChoiceOption<T>[];
  value: T | undefined;
  onPick: (value: T) => void;
}) {
  return (
    <div className="CNPG-filters">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          className="CNPG-filter"
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
