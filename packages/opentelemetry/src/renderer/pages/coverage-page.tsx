import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import {
  COVERAGE_FILTERS,
  type CoverageFilter,
  type CoverageRow,
  coverageLoadState,
  coverageSearchTexts,
  FILTER_LABELS,
  FILTER_TITLES,
  filterOf,
  matchesFilter,
} from "../api/coverage/coverage";
import { exporterOf } from "../api/coverage/exporter";
import { keyOf } from "../api/coverage/resolve";
import { namedKey } from "../api/overview/attention";
import { describeLoadState } from "../api/shared/store-state";
import { restartWorkload } from "../api/writes/actions";
import {
  BULK_RESTART_DETAIL,
  BULK_RESTART_TOOLTIP,
  COPY_ANNOTATION_TOOLTIP,
  RESTART_HINT,
  RESTART_TOOLTIP,
  restartRefusal,
} from "../api/writes/operations";
import { bulkAction } from "../components/bulk";
import { type Column, ListPage } from "../components/list-page";
import { StateCell } from "../components/state-cell";
import { CoverageDrawer } from "../coverage/coverage-drawer";
import { confirmRestart, copyAnnotation } from "../coverage/dialogs";
import { useInventory } from "../hooks/use-inventory";
import type { OpenPage } from "./overview-page";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export interface CoverageParams {
  kind?: { get(): string };
  namespace?: { get(): string };
  name?: { get(): string };
  filter?: { get(): string };
}

const COLUMNS: Column<CoverageRow>[] = [
  {
    title: "Name",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    title: "Namespace",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.namespace,
    sortValue: (row) => row.namespace,
  },
  {
    title: "Kind",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.kind,
    sortValue: (row) => row.kind,
  },
  {
    title: "Language",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => row.languages.map((language) => language.label).join(", "),
    sortValue: (row) => row.languages.map((language) => language.label).join(", "),
  },
  {
    title: "Instrumentation",
    className: "OpenTelemetry-table__shrink",
    cell: (row) => (row.instrumentation ? keyOf(row.instrumentation) : "—"),
    sortValue: (row) => (row.instrumentation ? keyOf(row.instrumentation) : undefined),
  },
  {
    title: "Injected",
    className: "OpenTelemetry-table__number",
    cell: (row) => (
      <span title={`${row.injected} of ${row.total} pods carry the agent`}>
        {row.injected}/{row.total}
      </span>
    ),
    sortValue: (row) => row.injected,
  },
  {
    title: "Container",
    className: "OpenTelemetry-table__shrink",
    cell: (row) =>
      row.containers.predicted ? (
        <span className="OpenTelemetry-muted">
          {row.containers.names.length > 0 ? `would be ${row.containers.names.join(", ")}` : "—"}
        </span>
      ) : (
        row.containers.names.join(", ")
      ),
    sortValue: (row) => row.containers.names.join(", ") || undefined,
  },
  {
    title: "State",
    className: "OpenTelemetry-table__fill",
    cell: (row) => <StateCell verdict={row.verdict} />,
    sortValue: (row) => row.verdict.label,
  },
];

export const CoveragePage = observer(
  ({ params, open }: { params?: CoverageParams; open?: OpenPage }) => {
    const { stores, coverage, operator } = useInventory({ collectors: false, coverage: true });
    const requested = params?.filter?.get();
    const [filter, setFilter] = useState<CoverageFilter>(() => filterOf(requested));
    const named = namedKey("coverage", {
      kind: params?.kind?.get(),
      namespace: params?.namespace?.get(),
      name: params?.name?.get(),
    });
    const [selectedKey, setSelectedKey] = useState(named);
    const selected = coverage.find((row) => row.key === selectedKey);
    const exporter =
      selected &&
      exporterOf(
        selected,
        { collectors: stores.everyCollector, pods: stores.pods, scope: stores.scope },
        Date.now(),
      );

    // The page stays mounted when a card names another filter.
    useEffect(() => {
      setFilter(filterOf(requested));
    }, [requested]);

    // An attention row names a workload: its drawer opens.
    useEffect(() => {
      if (named) setSelectedKey(named);
    }, [named]);

    return (
      <ListPage
        title="Coverage"
        subline={
          describeLoadState(coverageLoadState(stores.coverageState, coverage)) ??
          "Worst first. A row opens its pods and where its opt-in comes from."
        }
        section="opentelemetry-coverage"
        rows={coverage.filter((row) => matchesFilter(row, filter))}
        columns={COLUMNS}
        keyOf={(row) => row.key}
        searchTexts={coverageSearchTexts}
        onOpen={(row) => setSelectedKey(row.key)}
        empty={
          coverage.length === 0
            ? "No workload in the namespaces in scope opts in to auto-instrumentation."
            : "No workload matches that filter."
        }
        filters={
          <div className="OpenTelemetry-filters">
            {COVERAGE_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                className="OpenTelemetry-filter"
                aria-pressed={filter === key}
                title={FILTER_TITLES[key]}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>
        }
        selection={{
          hint: RESTART_HINT,
          actions: [
            bulkAction<CoverageRow>({
              label: "Restart",
              done: "Restarted",
              kind: "workload",
              tooltip: BULK_RESTART_TOOLTIP,
              caution: true,
              nameOf: (row) => `${row.namespace}/${row.name}`,
              refuse: restartRefusal,
              detail: BULK_RESTART_DETAIL,
              run: restartWorkload,
            }),
          ],
        }}
        menu={(row) => (
          <>
            <MenuItem onClick={() => void copyAnnotation(row, stores.instrumentations)}>
              <Icon material="content_copy" tooltip={COPY_ANNOTATION_TOOLTIP} />
              <span className="title">Copy annotation YAML</span>
            </MenuItem>
            <MenuItem onClick={() => confirmRestart(row)}>
              <Icon material="restart_alt" tooltip={RESTART_TOOLTIP} />
              <span className="title">Restart</span>
            </MenuItem>
          </>
        )}
      >
        <CoverageDrawer
          row={selected}
          exporter={exporter}
          operator={operator}
          instrumentations={stores.instrumentations}
          open={open}
          onClose={() => setSelectedKey(undefined)}
        />
      </ListPage>
    );
  },
);
