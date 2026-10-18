import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { subjectKey } from "../api/shared/subjects";
import { countCell } from "../api/shared/table";
import type { ReportSubject } from "../api/shared/types";
import { COVERAGE_STATUS } from "../api/workloads/coverage";
import {
  type CountColumn,
  countInColumn,
  describeEmpty,
  FILTER_LABELS,
  FILTER_TITLES,
  filterCounts,
  filterFromRoute,
  rowOf,
  selectWorkloads,
  type WorkloadColumn,
  type WorkloadFilter,
  workloadSearchTexts,
  workloadSortValue,
} from "../api/workloads/workload-filter";
import { getWorkloadRows, sortWorkloads, type WorkloadRow } from "../api/workloads/workload-rows";
import { type Column, ListPage } from "../components/list-page";
import { LoadGaps } from "../components/load-gaps";
import { Status } from "../components/status";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { WorkloadDrawer } from "../workload/workload-drawer";
import { PageGate } from "./page-head";

// A link names a workload and a filter in the route params; the page opens on them.
export interface WorkloadsRouteParams {
  namespace: { get(): string };
  kind: { get(): string };
  name: { get(): string };
  filter?: { get(): string };
}

function subjectFromParams(params?: WorkloadsRouteParams): ReportSubject | undefined {
  const namespace = params?.namespace.get() ?? "";
  const kind = params?.kind.get() ?? "";
  const name = params?.name.get() ?? "";

  if (!namespace || !kind || !name) return undefined;

  return { namespace, kind, name };
}

export function paramsOf({ namespace, kind, name }: ReportSubject) {
  return { namespace, kind, name };
}

function countColumn(title: CountColumn, severity?: "CRITICAL" | "HIGH"): Column<WorkloadRow> {
  return {
    title,
    className: "Trivy-table__number",
    cell: (row) => {
      const cell = countCell(row.state === "scanned" ? countInColumn(row, title) : undefined);

      if (cell.muted) return <span className="Trivy-muted">{cell.text}</span>;

      return severity ? (
        <span className={`Trivy-severity--${severity}`}>{cell.text}</span>
      ) : (
        cell.text
      );
    },
    sortValue: (row) => workloadSortValue(row, title),
  };
}

const sortBy = (title: WorkloadColumn) => (row: WorkloadRow) => workloadSortValue(row, title);

const COLUMNS: Column<WorkloadRow>[] = [
  {
    title: "Workload",
    className: "Trivy-table__fill",
    cell: (row) => {
      const owner = row.deployment;

      return (
        <span title={owner ? `${row.subject.name}, of Deployment ${owner}` : row.subject.name}>
          {row.subject.name}
        </span>
      );
    },
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
  const routedFilter = params?.filter?.get();
  const [filter, setFilter] = useState<WorkloadFilter>(() => filterFromRoute(routedFilter));
  const routed = subjectFromParams(params);
  const routedKey = routed ? subjectKey(routed) : undefined;
  const [openKey, setOpenKey] = useState(routedKey);

  // The page stays mounted when a link names another workload.
  useEffect(() => {
    setOpenKey(routedKey);
  }, [routedKey]);

  useEffect(() => {
    if (routedFilter) setFilter(filterFromRoute(routedFilter));
  }, [routedFilter]);

  // Rows from a partial load would grow under the reader as the other report kinds arrive.
  if (!stores.registered || stores.state !== "ready") {
    return (
      <PageGate
        title="Workloads"
        registered={stores.registered}
        state={stores.state}
        waiting="Waiting for the Trivy operator's report CRDs. If the operator is not installed here, there is nothing to list."
        unreachable="The Trivy operator's reports could not be read. Check the connection to the cluster and the permission to list them."
      />
    );
  }

  const rows = sortWorkloads(getWorkloadRows(stores));
  const counts = filterCounts(rows);

  return (
    <ListPage
      title="Workloads"
      filters={
        <>
          <LoadGaps gaps={stores.gaps} />
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
                <span className="Trivy-filter__count">{counts[key]}</span>
              </button>
            ))}
          </div>
        </>
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
