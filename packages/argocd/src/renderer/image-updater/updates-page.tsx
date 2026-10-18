import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useState } from "react";

import { undoRefusal } from "../api/image-updater/image-updater-details";
import {
  findRule,
  UPDATE_COLUMNS,
  UPDATE_SORT,
  updateKey,
  updateSearchTexts,
} from "../api/image-updater/image-updater-tables";
import { recentUpdates, trackedImages, type UpdateRow } from "../api/image-updater/image-updates";
import { describeRulesState, rankRules } from "../api/image-updater/rule-health";
import { emptyText } from "../api/shared/store-state";
import { RowDrawerLink } from "../components/drawer-link";
import { type Column, ListPage } from "../components/list-page";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { APPLICATIONS_PAGE } from "../pages/applications-page";
import { ago } from "./cells";
import { confirmUndo } from "./dialogs";
import { UpdateDrawer } from "./image-drawers";
import { RuleDrawer } from "./rule-drawer";

const {
  Component: { Icon, MenuItem },
} = Renderer;

export const ImageUpdaterUpdatesPage = observer(
  ({ extension }: { extension: Renderer.LensExtension }) => {
    const { updaters, applications, state, gap } = useImageUpdaterStores();
    const [opened, setOpened] = useState<{ update: string } | { rule: UpdateRow }>();
    const updates = recentUpdates(updaters);
    const now = Date.now();
    const ranked = rankRules(updaters, applications, now);
    const ruleOf = (update: UpdateRow) => findRule(ranked, update.updater, update.namespace);
    const update =
      opened && "update" in opened
        ? updates.find((each) => updateKey(each) === opened.update)
        : undefined;
    const rule = opened && "rule" in opened ? ruleOf(opened.rule) : undefined;
    // A rule selects Applications in its own namespace only.
    const openApplication = (namespace: string | undefined) => (name: string) => {
      setOpened(undefined);
      void extension.navigate(APPLICATIONS_PAGE, { name, namespace: namespace ?? "" });
    };

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
        cell: (update) => (
          <RowDrawerLink
            label={update.updater}
            title="Opens its rule"
            onOpen={() => setOpened({ rule: update })}
          />
        ),
        sortValue: UPDATE_SORT[UPDATE_COLUMNS.rule],
      },
    ];

    const menu = (update: UpdateRow) => {
      const rule = ruleOf(update)?.updater;

      if (!rule) return null;

      const refusal = undoRefusal(update, rule, applications);

      return (
        <MenuItem
          disabled={Boolean(refusal)}
          onClick={() => confirmUndo(rule, update, applications)}
        >
          <Icon
            material="undo"
            tooltip={
              refusal
                ? `No Undo here: ${refusal}`
                : "Puts the previous tag back on the Applications and keeps it there. Asks first"
            }
          />
          <span className="title">Undo</span>
        </MenuItem>
      );
    };

    return (
      <ListPage
        title="Last updates"
        subline="The controller keeps only each rule's most recent update, so this is what each rule changed last, not a full history. A row opens the update."
        alarm={state === "unreachable" ? describeRulesState(state) : gap}
        section="image-updater-updates"
        rows={updates}
        columns={columns}
        keyOf={updateKey}
        searchTexts={updateSearchTexts}
        onOpen={(row) => setOpened({ update: updateKey(row) })}
        menu={menu}
        empty={emptyText(state, describeRulesState, "No rule has updated an image yet.")}
      >
        <UpdateDrawer
          update={update}
          rule={update ? ruleOf(update)?.updater : undefined}
          images={update ? trackedImages(updaters, applications) : []}
          applications={applications}
          onClose={() => setOpened(undefined)}
          onOpenRule={() => update && setOpened({ rule: update })}
          onOpenApplication={openApplication(update?.namespace)}
        />
        <RuleDrawer
          updater={rule?.updater}
          health={rule?.health}
          applications={applications}
          onClose={() => setOpened(undefined)}
          onOpenApplication={openApplication(rule?.updater.getNs())}
        />
      </ListPage>
    );
  },
);
