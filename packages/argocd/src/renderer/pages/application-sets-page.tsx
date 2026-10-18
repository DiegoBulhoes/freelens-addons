import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import {
  type ApplicationSetRow,
  describeApplicationSetsState,
  describeGenerators,
  rankApplicationSets,
  SET_COLUMNS,
  SET_SORT,
  setSearchTexts,
} from "../api/application-sets/application-set";
import { keyFor, namedKey } from "../api/shared/identity";
import { emptyText } from "../api/shared/store-state";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { ApplicationSetDrawer } from "../details/application-set-drawer";
import { useApplicationSetStores } from "../hooks/use-application-set-stores";
import { APPLICATIONS_PAGE } from "./applications-page";

export const APPLICATION_SETS_PAGE = "application-sets";

export interface ApplicationSetsParams {
  name?: { get(): string };
  namespace?: { get(): string };
}

const keyOf = (row: ApplicationSetRow) => keyFor(row.set.getName(), row.set.getNs());

const COLUMNS: Column<ApplicationSetRow>[] = [
  {
    title: SET_COLUMNS.name,
    className: "ArgoCD-table__shrink",
    cell: (row) => row.set.getName(),
    sortValue: SET_SORT[SET_COLUMNS.name],
  },
  {
    title: SET_COLUMNS.namespace,
    className: "ArgoCD-table__shrink",
    cell: (row) => row.set.getNs(),
    sortValue: SET_SORT[SET_COLUMNS.namespace],
  },
  {
    title: SET_COLUMNS.generators,
    className: "ArgoCD-table__shrink",
    cell: (row) => describeGenerators(row.set),
    sortValue: SET_SORT[SET_COLUMNS.generators],
  },
  {
    title: SET_COLUMNS.applications,
    className: "ArgoCD-table__shrink",
    cell: (row) => (
      <span title={row.summary.title || undefined}>
        {row.summary.count ?? "—"}
        <span className="ArgoCD-muted"> · {row.summary.label}</span>
      </span>
    ),
    sortValue: SET_SORT[SET_COLUMNS.applications],
  },
  {
    title: SET_COLUMNS.conditions,
    className: "ArgoCD-table__fill",
    cell: (row) => (
      <>
        <Status tone={row.verdict.tone} label={row.verdict.label} title={row.verdict.reason} />
        {row.verdict.cause && <span className="ArgoCD-muted"> {row.verdict.cause}</span>}
      </>
    ),
    sortValue: SET_SORT[SET_COLUMNS.conditions],
  },
];

export const ApplicationSetsPage = observer(
  ({
    extension,
    params,
  }: {
    extension: Renderer.LensExtension;
    params?: ApplicationSetsParams;
  }) => {
    const { sets, applications, state, applicationsState, gap } = useApplicationSetStores();
    const named = namedKey(params?.name?.get(), params?.namespace?.get());
    const [selectedKey, setSelectedKey] = useState(named);

    // A link elsewhere names a set: its drawer opens, even with the page already mounted.
    useEffect(() => {
      if (named) setSelectedKey(named);
    }, [named]);

    const rows = rankApplicationSets(sets, applications, applicationsState);
    const selected = rows.find((row) => keyOf(row) === selectedKey);

    return (
      <ListPage
        title="ApplicationSets"
        subline="A set opens with its generators, its template and the Applications it owns."
        alarm={state === "unreachable" ? describeApplicationSetsState(state) : gap}
        section="application-sets"
        rows={rows}
        columns={COLUMNS}
        keyOf={keyOf}
        searchTexts={setSearchTexts}
        onOpen={(row) => setSelectedKey(keyOf(row))}
        empty={emptyText(
          state,
          describeApplicationSetsState,
          "No ApplicationSets in the namespaces in scope.",
        )}
      >
        <ApplicationSetDrawer
          row={selected}
          onClose={() => setSelectedKey(undefined)}
          onOpenApplication={(application) => {
            setSelectedKey(undefined);
            void extension.navigate(APPLICATIONS_PAGE, {
              name: application.getName(),
              namespace: application.getNs() ?? "",
            });
          }}
        />
      </ListPage>
    );
  },
);
