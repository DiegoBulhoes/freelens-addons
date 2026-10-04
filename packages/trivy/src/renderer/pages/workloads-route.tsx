import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import { COVERAGE_STATUS } from "../api/coverage";
import { subjectKey } from "../api/subjects";
import type { ReportSubject } from "../api/types";
import {
  countIn,
  describeEmpty,
  FILTER_LABELS,
  FILTER_TITLES,
  isWorkloadFilter,
  rowOf,
  selectWorkloads,
  type WorkloadColumn,
  type WorkloadFilter,
  workloadSearchTexts,
  workloadSortValue,
} from "../api/workload-filter";
import { getWorkloadRows, sortRows, type WorkloadRow } from "../api/workload-rows";
import { type Column, ListPage } from "../components/list-page";
import { NamespaceFilter } from "../components/namespace-filter";
import { Status } from "../components/status";
import { TrivyStyles } from "../components/styles";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { WorkloadDrawer } from "../workload/workload-drawer";

const {
  Component: { Spinner },
} = Renderer;

// A link names a workload and a filter in the route params; the page opens on them.
export interface WorkloadsRouteParams {
  namespace: { get(): string };
  kind: { get(): string };
  name: { get(): string };
  filter?: { get(): string };
}

export function subjectFrom(params?: WorkloadsRouteParams): ReportSubject | undefined {
  const namespace = params?.namespace.get() ?? "";
  const kind = params?.kind.get() ?? "";
  const name = params?.name.get() ?? "";

  if (!namespace || !kind || !name) return undefined;

  return { namespace, kind, name };
}

function countColumn(
  title: "Critical" | "High" | "Other" | "Fix published",
  severity?: "CRITICAL" | "HIGH",
): Column<WorkloadRow> {
  return {
    title,
    className: "Trivy-table__number",
    cell: (row) => {
      if (row.state !== "scanned") return <span className="Trivy-muted">—</span>;

      const count = countIn(row, title);

      if (count === 0) return <span className="Trivy-muted">0</span>;

      return severity ? <span className={`Trivy-severity--${severity}`}>{count}</span> : count;
    },
    sortValue: (row) => workloadSortValue(row, title),
  };
}

const sortBy = (title: WorkloadColumn) => (row: WorkloadRow) => workloadSortValue(row, title);

const COLUMNS: Column<WorkloadRow>[] = [
  {
    title: "Workload",
    className: "Trivy-table__fill",
    cell: (row) => <span title={row.subject.name}>{row.subject.name}</span>,
    sortValue: sortBy("Workload"),
  },
  {
    title: "Kind",
    className: "Trivy-table__shrink",
    cell: (row) => row.subject.kind,
    sortValue: sortBy("Kind"),
  },
  {
    title: "Namespace",
    className: "Trivy-table__shrink",
    cell: (row) => row.subject.namespace,
    sortValue: sortBy("Namespace"),
  },
  {
    title: "Coverage",
    className: "Trivy-table__shrink",
    cell: (row) => (
      <Status tone={COVERAGE_STATUS[row.state].tone} label={COVERAGE_STATUS[row.state].label} />
    ),
    sortValue: sortBy("Coverage"),
  },
  countColumn("Critical", "CRITICAL"),
  countColumn("High", "HIGH"),
  countColumn("Other"),
  countColumn("Fix published"),
];

export const WorkloadsRoute = observer(({ params }: { params?: WorkloadsRouteParams }) => {
  const stores = useTrivyStores();
  const [filter, setFilter] = useState<WorkloadFilter>(() => {
    const fromRoute = params?.filter?.get();

    return isWorkloadFilter(fromRoute) ? fromRoute : "all";
  });
  const routed = subjectFrom(params);
  const routedKey = routed ? subjectKey(routed) : undefined;
  const [openKey, setOpenKey] = useState(routedKey);

  // The page stays mounted when a link names another workload.
  useEffect(() => {
    setOpenKey(routedKey);
  }, [routedKey]);

  if (!stores.isReady) {
    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        <div className="Trivy-page__head">
          <div>
            <h1 className="Trivy-page__headline">Workloads</h1>
            <p className="Trivy-page__subline">
              Waiting for the Trivy operator's report CRDs. If the operator is not installed here,
              there is nothing to list.
            </p>
          </div>
          <div className="Trivy-page__actions">
            <NamespaceFilter />
          </div>
        </div>
      </div>
    );
  }

  // Rows from a partial load would grow under the reader as the other report kinds arrive.
  if (!stores.hasLoaded) {
    return (
      <div className="Trivy Trivy-page">
        <TrivyStyles />
        {stores.gaveUp ? (
          <div className="Trivy-page__head">
            <div>
              <h1 className="Trivy-page__headline">Workloads</h1>
              <p className="Trivy-page__subline Trivy-page__subline--alarm">
                The Trivy operator's reports could not be read. Check the connection to the cluster
                and the permission to list them.
              </p>
            </div>
          </div>
        ) : (
          <Spinner center />
        )}
      </div>
    );
  }

  const rows = sortRows(getWorkloadRows(stores));

  return (
    <ListPage
      title="Workloads"
      filters={
        <div className="Trivy-filters">
          {(Object.keys(FILTER_LABELS) as WorkloadFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              className="Trivy-filter"
              aria-pressed={filter === key}
              title={FILTER_TITLES[key]}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
        </div>
      }
      rows={selectWorkloads(rows, filter)}
      columns={COLUMNS}
      keyOf={(row) => subjectKey(row.subject)}
      searchTexts={workloadSearchTexts}
      onOpen={(row) => setOpenKey(subjectKey(row.subject))}
      empty={describeEmpty(rows.length, filter)}
    >
      <WorkloadDrawer
        row={rowOf(rows, openKey)}
        stores={stores}
        onClose={() => setOpenKey(undefined)}
      />
    </ListPage>
  );
});
