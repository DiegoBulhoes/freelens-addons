import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import {
  ruleKey,
  UPDATE_COLUMNS,
  UPDATE_SORT,
  updateSearchTexts,
} from "../api/image-updater-tables";
import { describeRulesState, rankRules, recentUpdates, type UpdateRow } from "../api/image-updates";
import { type Column, ListPage } from "../components/list-page";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { confirmUndo } from "./dialogs";
import { RuleDrawer } from "./rule-drawer";
import { ago } from "./shared";

const {
  Component: { Icon, MenuItem },
} = Renderer;

const keyOf = (update: UpdateRow) =>
  `${update.namespace}/${update.updater}/${update.alias}/${update.to}`;

export const ImageUpdaterUpdatesPage = observer(
  ({ extension }: { extension: Renderer.LensExtension }) => {
    const { updaters, applications, state } = useImageUpdaterStores();
    const [selectedRule, setSelectedRule] = useState<string>();
    const updates = recentUpdates(updaters);
    const now = Date.now();
    const ranked = rankRules(updaters, applications, now);
    const ruleFor = (key: string | undefined) =>
      ranked.find((row) => ruleKey(row.updater.getName(), row.updater.getNs()) === key);
    const selected = ruleFor(selectedRule);

    const columns: Column<UpdateRow>[] = [
      {
        title: UPDATE_COLUMNS.when,
        className: "ArgoCD-table__shrink",
        cell: (update) => <span className="ArgoCD-muted">{ago(update.at, now)}</span>,
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.when],
      },
      {
        title: UPDATE_COLUMNS.image,
        className: "ArgoCD-table__fill",
        cell: (update) => (
          <>
            {update.alias}
            <span className="ArgoCD-muted"> · {update.image}</span>
          </>
        ),
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.image],
      },
      {
        title: UPDATE_COLUMNS.from,
        className: "ArgoCD-table__shrink",
        cell: (update) => <span className="ArgoCD-mono">{update.from ?? "—"}</span>,
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.from],
      },
      {
        title: UPDATE_COLUMNS.to,
        className: "ArgoCD-table__shrink",
        cell: (update) => <span className="ArgoCD-mono">{update.to}</span>,
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.to],
      },
      {
        title: UPDATE_COLUMNS.applications,
        className: "ArgoCD-table__number",
        cell: (update) => update.applications,
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.applications],
      },
      {
        title: UPDATE_COLUMNS.rule,
        className: "ArgoCD-table__shrink",
        cell: (update) => <span className="ArgoCD-muted">{update.updater}</span>,
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.rule],
      },
    ];

    const menu = (update: UpdateRow) => {
      const rule = ruleFor(ruleKey(update.updater, update.namespace))?.updater;

      if (!rule) return null;

      return (
        <MenuItem onClick={() => confirmUndo(rule, update, applications)}>
          <Icon
            material="undo"
            tooltip="Puts the previous tag back on the Applications and keeps it there. Asks first"
          />
          <span className="title">Undo</span>
        </MenuItem>
      );
    };

    return (
      <ListPage
        title="Last updates"
        subline="The controller keeps only each rule's most recent update, so this is what each rule changed last, not a full history. A row opens its rule."
        alarm={state === "unreachable" ? describeRulesState(state) : undefined}
        note={state === "unreachable" ? undefined : describeRulesState(state)}
        section="image-updater-updates"
        rows={updates}
        columns={columns}
        keyOf={keyOf}
        searchTexts={updateSearchTexts}
        onOpen={(update) => setSelectedRule(ruleKey(update.updater, update.namespace))}
        menu={menu}
        empty="No rule has updated an image yet."
      >
        <RuleDrawer
          updater={selected?.updater}
          health={selected?.health}
          applications={applications}
          onClose={() => setSelectedRule(undefined)}
          onOpenApplication={(name) => {
            setSelectedRule(undefined);
            void extension.navigate("applications", { name });
          }}
        />
      </ListPage>
    );
  },
);
