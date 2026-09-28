import type { Renderer as RendererTypes } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import type { ReportSubject } from "../api/types";
import { FILTER_LABELS, selectWorkloads, type WorkloadFilter } from "../api/workload-filter";
import { getWorkloadRows, sortRows } from "../api/workload-rows";
import { TrivyStyles } from "../components/styles";
import { useTrivyStores } from "../hooks/use-trivy-stores";
import { WorkloadDetail } from "../workload/workload-detail";
import { WorkloadList } from "../workload/workload-list";

/**
 * Pick on the left, read on the right.
 *
 * One page rather than a list that navigates to a detail: the sidebar item
 * stays lit because there is only ever one page, and moving between workloads
 * costs a click instead of a round trip through the list.
 *
 * The selection lives in the route params all the same, so a link to one
 * workload still opens on it.
 */
export interface WorkloadsRouteParams {
  namespace: { get(): string };
  kind: { get(): string };
  name: { get(): string };
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
    const [filter, setFilter] = useState<WorkloadFilter>("all");
    const [search, setSearch] = useState("");

    const fromRoute = subjectFrom(params);
    const rows = sortRows(getWorkloadRows(stores));
    const shown = selectWorkloads(rows, filter, search);

    // Falls back to the first row so the pane is never empty on arrival, but a
    // deliberate selection always wins.
    const selected = fromRoute ?? shown[0]?.subject;

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
          <p className="Trivy-section__note">
            Waiting for the Trivy operator's report CRDs. If the operator is not installed here,
            there is nothing to list.
          </p>
        </div>
      );
    }

    return (
      <div className="Trivy Trivy-picker">
        <TrivyStyles />

        <div className="Trivy-picker__side">
          <div className="Trivy-filters">
            {(Object.keys(FILTER_LABELS) as WorkloadFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className="Trivy-filter"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
          </div>

          <input
            className="Trivy-search"
            type="search"
            value={search}
            placeholder={`Filter ${rows.length} workloads`}
            onChange={(event) => setSearch(event.target.value)}
          />

          <WorkloadList rows={shown} selected={selected} onSelect={select} />
        </div>

        <div className="Trivy-picker__detail">
          {selected ? (
            <WorkloadDetail subject={selected} />
          ) : (
            <p className="Trivy-picker__empty">Nothing matches that filter.</p>
          )}
        </div>
      </div>
    );
  },
);
