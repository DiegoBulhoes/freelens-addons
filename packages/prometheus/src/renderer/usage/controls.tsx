import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useState } from "react";

import { describeMixedClusters, describeUsageState, type UsageState } from "../api/usage/usage";
import { type ChoiceNames, describeChoice } from "../api/usage/usage-filters";
import {
  DEFAULT_WINDOW,
  describePeriod,
  describeRefresh,
  editorRange,
  isFixed,
  type Period,
  parseRange,
  refreshFor,
  type TypedRange,
  WINDOWS,
  type WindowId,
} from "../api/usage/usage-queries";
import { PrometheusStyles } from "../components/styles";
import { useVisibleTick } from "../hooks/use-visible-tick";

const {
  Component: { ConfirmDialog, Icon, Input, Select, WithTooltip },
  Theme,
} = Renderer;

// Shared by both pages, so moving between them keeps the window and the nodes.
let lastPeriod: Period = { id: DEFAULT_WINDOW };
let lastNodes: string[] = [];

export function useUsagePeriod(): { period: Period; choose: (period: Period) => void } {
  const [period, setPeriod] = useState<Period>(lastPeriod);

  return {
    period,
    choose: (next) => {
      lastPeriod = next;
      setPeriod(next);
    },
  };
}

export function useChosenNodes(): [string[], (nodes: string[]) => void] {
  const [nodes, setNodes] = useState(lastNodes);

  return [
    nodes,
    (next) => {
      lastNodes = next;
      setNodes(next);
    },
  ];
}

export function useRefresh(period: Period): { tick: number; refresh: () => void } {
  const [pressed, setPressed] = useState(0);

  return {
    tick: useVisibleTick(refreshFor(period)) + pressed,
    refresh: () => setPressed((n) => n + 1),
  };
}

function TimeField({
  label,
  initial,
  onType,
}: {
  label: string;
  initial: string;
  onType: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div className="Prometheus-form__field">
      <span>{label}</span>
      <Input
        type="datetime-local"
        aria-label={label}
        value={value}
        onChange={(next: string) => {
          setValue(next);
          onType(next);
        }}
      />
    </div>
  );
}

// As the host's own custom time range: a dialog with two local times, refused when invalid.
function openRangeDialog(
  period: Period,
  onApply: (period: Period) => void,
  typed?: TypedRange,
): void {
  const opened = editorRange(period, Date.now(), typed);
  let { from, to } = opened;

  ConfirmDialog.open({
    labelOk: "Apply",
    okButtonProps: { primary: true },
    message: (
      <div
        className="Prometheus Prometheus-dialog"
        data-section="prometheus-usage-range"
        // The date picker's own icon and popup follow it, and stay legible on the dark theme.
        style={{ colorScheme: Theme.activeTheme.get().type }}
      >
        {/* The dialog opens outside the page, which mounts no stylesheet of ours there. */}
        <PrometheusStyles />
        <p>Charts a fixed range in local time; it is asked again only when Refresh is pressed.</p>
        {opened.error && (
          <div
            className="Prometheus-banner Prometheus-banner--critical"
            data-section="prometheus-usage-range-error"
          >
            <div className="Prometheus-banner__title">Range refused</div>
            <div className="Prometheus-banner__body">{opened.error}</div>
          </div>
        )}
        <div className="Prometheus-form">
          <TimeField
            label="Start of the range"
            initial={from}
            onType={(value) => {
              from = value;
            }}
          />
          <TimeField
            label="End of the range"
            initial={to}
            onType={(value) => {
              to = value;
            }}
          />
        </div>
      </div>
    ),
    ok: () => {
      const chosen = parseRange(from, to, Date.now());

      // The dialog closes after ok returns, so it reopens on the next turn, with what was typed.
      if ("error" in chosen) {
        setTimeout(() => openRangeDialog(period, onApply, { from, to, error: chosen.error }));
      } else onApply(chosen);
    },
  });
}

interface Choice {
  value: string;
  label: string;
}

const CUSTOM = "custom";

const WINDOW_OPTIONS: Choice[] = [
  ...WINDOWS.map((each) => ({ value: each.id, label: each.label })),
  { value: CUSTOM, label: "Custom range" },
];

export function UsageControls({
  period,
  onChange,
  children,
}: {
  period: Period;
  onChange: (period: Period) => void;
  children?: ReactNode;
}) {
  const fixed = isFixed(period);

  return (
    <div
      className="Prometheus-filters Prometheus-usage__controls"
      data-section="prometheus-usage-controls"
    >
      <div className="Prometheus-usage__window" data-section="prometheus-usage-window">
        <Select<string, Choice, false>
          id="prometheus-usage-window-select"
          options={WINDOW_OPTIONS}
          value={fixed ? CUSTOM : period.id}
          themeName="lens"
          isSearchable={false}
          menuPlacement="auto"
          onChange={(option) => {
            if (!option) return;
            if (option.value === CUSTOM) openRangeDialog(period, onChange);
            else onChange({ id: option.value as WindowId });
          }}
        />
      </div>
      {fixed && (
        <span
          className="Prometheus-muted Prometheus-truncate"
          data-section="prometheus-usage-range-label"
        >
          {describePeriod(period)}
        </span>
      )}
      {children}
    </div>
  );
}

const ALL = "";

/** Mirrors the host's NamespaceSelectFilter; the first option clears. */
export function ChoiceFilter({
  id,
  choices,
  chosen,
  names,
  onChange,
  section,
}: {
  id: string;
  choices: string[];
  chosen: string[];
  names: ChoiceNames;
  onChange: (chosen: string[]) => void;
  section: string;
}) {
  const options: Choice[] = [
    { value: ALL, label: names.all },
    ...choices.map((choice) => ({ value: choice, label: choice })),
  ];
  const selected = (value: string) =>
    value === ALL ? chosen.length === 0 : chosen.includes(value);

  return (
    <div className="Prometheus-usage__choice" data-section={section}>
      <Select<string, Choice, true>
        id={id}
        className="NamespaceSelectFilter"
        isMulti
        isClearable={false}
        closeMenuOnSelect={false}
        controlShouldRenderValue={false}
        hideSelectedOptions={false}
        placeholder={describeChoice(chosen, names)}
        options={options}
        value={chosen}
        isOptionSelected={(option) => selected(option.value)}
        formatOptionLabel={(option) => (
          <span className="Prometheus-usage__option">
            {option.label}
            {selected(option.value) && <Icon small material="check" />}
          </span>
        )}
        onChange={(_, meta) => {
          const value = meta.option?.value;

          if (value === undefined) return;
          if (value === ALL) onChange([]);
          else
            onChange(
              chosen.includes(value) ? chosen.filter((each) => each !== value) : [...chosen, value],
            );
        }}
      />
    </div>
  );
}

export function RefreshButton({
  onClick,
  loading,
  period,
}: {
  onClick: () => void;
  loading: boolean;
  period: Period;
}) {
  return (
    <WithTooltip tooltip={`Asks Prometheus again now. ${describeRefresh(period)}`}>
      {/* Busy, not disabled: the last figures stay, and a press while reading asks nothing. */}
      <button type="button" className="Prometheus-button" onClick={onClick} aria-busy={loading}>
        Refresh
      </button>
    </WithTooltip>
  );
}

export function UsageNotice({
  state,
  clusters = [],
}: {
  state: UsageState | undefined;
  clusters?: string[];
}) {
  const message = state && describeUsageState(state);
  const mixed = describeMixedClusters(clusters);

  return (
    <>
      {message && (
        <div
          className="Prometheus-banner Prometheus-usage__notice"
          data-section="prometheus-usage-notice"
        >
          <div className="Prometheus-banner__title">
            {state === "not-configured" ? "No Prometheus answers" : "No node metrics"}
          </div>
          <div className="Prometheus-banner__body">{message}</div>
        </div>
      )}
      {mixed && (
        <div
          className="Prometheus-banner Prometheus-usage__notice"
          data-section="prometheus-usage-clusters"
        >
          <div className="Prometheus-banner__title">Series from several clusters</div>
          <div className="Prometheus-banner__body">{mixed}</div>
        </div>
      )}
    </>
  );
}
