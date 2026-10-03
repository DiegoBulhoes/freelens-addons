import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { RULE_COLUMNS, RULE_SORT, ruleKey, ruleSearchTexts } from "../api/image-updater-tables";
import { describeRulesState, type RuleRow, rankRules } from "../api/image-updates";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { RuleDrawer } from "./rule-drawer";
import { ago } from "./shared";

const keyOf = (row: RuleRow) => ruleKey(row.updater.getName(), row.updater.getNs());

export const ImageUpdaterRulesPage = observer(
  ({ extension }: { extension: Renderer.LensExtension }) => {
    const { updaters, applications, state } = useImageUpdaterStores();
    const [selectedKey, setSelectedKey] = useState<string>();
    const now = Date.now();

    const ranked = rankRules(updaters, applications, now);
    const selected = ranked.find((row) => keyOf(row) === selectedKey);

    const columns: Column<RuleRow>[] = [
      {
        title: RULE_COLUMNS.rule,
        className: "ArgoCD-table__shrink",
        cell: (row) => (
          <>
            {row.updater.getName()}
            <span className="ArgoCD-muted"> · {row.updater.getNs()}</span>
          </>
        ),
        sortValue: RULE_SORT[RULE_COLUMNS.rule],
      },
      {
        title: RULE_COLUMNS.state,
        className: "ArgoCD-table__fill",
        cell: (row) => (
          <Status tone={row.health.tone} label={row.health.label} title={row.health.reason} />
        ),
        sortValue: RULE_SORT[RULE_COLUMNS.state],
      },
      {
        title: RULE_COLUMNS.applications,
        className: "ArgoCD-table__number",
        cell: (row) => row.updater.status?.applicationsMatched ?? "—",
        sortValue: RULE_SORT[RULE_COLUMNS.applications],
      },
      {
        title: RULE_COLUMNS.images,
        className: "ArgoCD-table__number",
        cell: (row) => row.updater.status?.imagesManaged ?? "—",
        sortValue: RULE_SORT[RULE_COLUMNS.images],
      },
      {
        title: RULE_COLUMNS.checked,
        className: "ArgoCD-table__shrink",
        cell: (row) => (
          <span className="ArgoCD-muted">{ago(row.updater.status?.lastCheckedAt, now)}</span>
        ),
        sortValue: RULE_SORT[RULE_COLUMNS.checked],
      },
      {
        title: RULE_COLUMNS.lastUpdate,
        className: "ArgoCD-table__shrink",
        cell: (row) => (
          <span className="ArgoCD-muted">{ago(row.updater.status?.lastUpdatedAt, now)}</span>
        ),
        sortValue: RULE_SORT[RULE_COLUMNS.lastUpdate],
      },
    ];

    return (
      <ListPage
        title="Image Updater rules"
        subline="A rule opens with its images, its last update and what can be done about it."
        alarm={state === "unreachable" ? describeRulesState(state) : undefined}
        note={state === "unreachable" ? undefined : describeRulesState(state)}
        section="image-updater-rules"
        rows={ranked}
        columns={columns}
        keyOf={keyOf}
        searchTexts={ruleSearchTexts}
        onOpen={(row) => setSelectedKey(keyOf(row))}
        empty="No ImageUpdater rules in the namespaces in scope."
      >
        <RuleDrawer
          updater={selected?.updater}
          health={selected?.health}
          applications={applications}
          onClose={() => setSelectedKey(undefined)}
          onOpenApplication={(name) => {
            setSelectedKey(undefined);
            void extension.navigate("applications", { name });
          }}
        />
      </ListPage>
    );
  },
);
