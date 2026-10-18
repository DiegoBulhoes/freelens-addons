import { observer } from "mobx-react";

import type { OpenPage } from "../api/overview/attention";
import {
  isRuleFilter,
  loadedBy,
  matchesRuleFilter,
  RULE_FILTER_TITLES,
  RULE_FILTERS,
  type RuleFilter,
  type RuleRow,
} from "../api/rules/rules";
import { shortSourceNames } from "../api/shared/facts";
import { ruleFixes } from "../api/shared/fixes";
import { describeRefusedEvents } from "../api/shared/rejections";
import { namespaceLabelsOf } from "../api/shared/selection";
import { describeLoadState } from "../api/shared/store-state";
import { worstFirst } from "../api/shared/verdict";
import { FixMenuItems } from "../components/commands-section";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { useInventory } from "../hooks/use-inventory";
import { RuleDrawer } from "../rules/rule-drawer";
import { type ListParams, useListRoute } from "./list-params";

const LABELS: Record<RuleFilter, string> = {
  attention: "Needs attention",
  firing: "Firing or pending",
  "not-loaded": "Not loaded",
  rejected: "Rejected or failing",
  healthy: "Loaded",
  unknown: "Unknown",
};

const loadedByNames = (row: RuleRow) => shortSourceNames(loadedBy(row));

const COLUMNS: Column<RuleRow>[] = [
  {
    title: "Name",
    className: "Prometheus-table__shrink",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    title: "Namespace",
    className: "Prometheus-table__shrink",
    cell: (row) => row.namespace,
    sortValue: (row) => row.namespace,
  },
  {
    title: "Loaded by",
    className: "Prometheus-table__shrink",
    cell: loadedByNames,
    sortValue: loadedByNames,
  },
  {
    title: "Groups",
    className: "Prometheus-table__number",
    cell: (row) => row.groups,
    sortValue: (row) => row.groups,
  },
  {
    title: "Rules",
    className: "Prometheus-table__shrink",
    cell: (row) => `${row.alerting} alerting · ${row.recording} recording`,
    sortValue: (row) => row.alerting + row.recording,
  },
  {
    title: "Firing",
    className: "Prometheus-table__number",
    cell: (row) => row.firing.length,
    sortValue: (row) => row.firing.length,
  },
  {
    title: "State",
    className: "Prometheus-table__fill",
    cell: (row) => <StateCell verdict={row.verdict} />,
    sortValue: (row) => row.verdict.label,
  },
];

export const RulesPage = observer(({ params, open }: { params?: ListParams; open: OpenPage }) => {
  const { stores, rules, eventsRefused, live } = useInventory({ monitors: false, rules: true });
  const { filter, setFilter, selectedKey, setSelectedKey } = useListRoute(params, isRuleFilter);
  const selected = rules.find((row) => row.key === selectedKey);
  const namespaceLabels = namespaceLabelsOf(stores.namespaces);
  const fixesOf = (row: RuleRow) => ruleFixes(row, stores.sources, namespaceLabels);
  const counts = Object.fromEntries(
    RULE_FILTERS.map((each) => [each, rules.filter((row) => matchesRuleFilter(row, each)).length]),
  ) as Record<RuleFilter, number>;

  return (
    <ListPage
      live={live}
      title="Rules"
      subline={[
        describeLoadState(stores.state) ??
          "PrometheusRules, worst first. A row opens which Prometheus loads it and what fires.",
        describeRefusedEvents(eventsRefused),
      ]
        .filter(Boolean)
        .join(" ")}
      section="prometheus-rules"
      rows={worstFirst(rules.filter((row) => matchesRuleFilter(row, filter)))}
      columns={COLUMNS}
      keyOf={(row) => row.key}
      searchTexts={(row) => [
        row.name,
        row.namespace,
        loadedByNames(row),
        row.verdict.label,
        ...row.firing.map((alert) => alert.labels.alertname ?? ""),
      ]}
      onOpen={(row) => setSelectedKey(row.key)}
      empty={
        rules.length === 0
          ? "No PrometheusRule in the namespaces in scope."
          : "No rule matches that filter."
      }
      initialQuery={params?.name?.get()}
      filters={
        <FilterChips
          filters={RULE_FILTERS}
          labels={LABELS}
          titles={RULE_FILTER_TITLES}
          counts={counts}
          current={filter}
          onChange={setFilter}
          section="prometheus-rule-filters"
        />
      }
      menu={(row) => <FixMenuItems fixes={fixesOf(row)} />}
    >
      <RuleDrawer
        row={selected}
        fixes={selected ? fixesOf(selected) : []}
        onClose={() => setSelectedKey(undefined)}
        open={open}
      />
    </ListPage>
  );
});
