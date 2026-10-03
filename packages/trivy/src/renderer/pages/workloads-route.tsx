import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import type { ReportSubject } from "../api/types";
import {
  chooseSelected,
  describeEmpty,
  FILTER_LABELS,
  FILTER_TITLES,
  isWorkloadFilter,
  selectWorkloads,
  type WorkloadFilter,
} from "../api/workload-filter";
import { getWorkloadRows, sortRows } from "../api/workload-rows";
import { NamespaceFilter } from "../components/namespace-filter";
import { TrivyStyles } from "../components/styles";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { WorkloadDetail } from "../workload/workload-detail";
import { WorkloadList } from "../workload/workload-list";

// Selection and filter live in the route params, so a link opens on them.
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

export const WorkloadsRoute = observer(
  ({
    params,
    extension,
  }: {
    params?: WorkloadsRouteParams;
    extension: RendererTypes.LensExtension;
  }) => {
    const stores = useTrivyStores();
    const [filter, setFilter] = useState<WorkloadFilter>(() => {
      const fromRoute = params?.filter?.get();

      return isWorkloadFilter(fromRoute) ? fromRoute : "all";
    });
    const [search, setSearch] = useState("");

    const fromRoute = subjectFrom(params);
    const rows = sortRows(getWorkloadRows(stores));
    const shown = selectWorkloads(rows, filter, search);

    const selected = chooseSelected(rows, shown, fromRoute);

    const select = (subject: ReportSubject) =>
      void extension.navigate("workloads", {
        namespace: subject.namespace,
        kind: subject.kind,
        name: subject.name,
      });

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

    return (
      <div className="Trivy Trivy-picker">
        <TrivyStyles />

        <div className="Trivy-picker__side">
          <div className="Trivy-section">
            <NamespaceFilter />
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
          </div>

          <input
            className="Trivy-search"
            type="search"
            value={search}
            placeholder={`Filter ${rows.length} workloads`}
            aria-label="Search the workloads by namespace, kind or name"
            onChange={(event) => setSearch(event.target.value)}
          />

          <WorkloadList rows={shown} selected={selected} onSelect={select} />
        </div>

        <div className="Trivy-picker__detail">
          {selected ? (
            <WorkloadDetail subject={selected} stores={stores} />
          ) : (
            <p className="Trivy-picker__empty">{describeEmpty(rows.length, filter, search)}</p>
          )}
        </div>
      </div>
    );
  },
);
