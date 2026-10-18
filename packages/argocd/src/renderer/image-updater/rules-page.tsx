import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import {
  RULE_COLUMNS,
  RULE_SORT,
  ruleSearchTexts,
} from "../api/image-updater/image-updater-tables";
import { applyFilter, filterNamed } from "../api/image-updater/image-updates";
import {
  describeRulesState,
  RULE_FILTERS,
  type RuleFilter,
  type RuleRow,
  rankRules,
} from "../api/image-updater/rule-health";
import { keyFor, namedKey } from "../api/shared/identity";
import { emptyText } from "../api/shared/store-state";
import { deleteRule } from "../api/writes/image-updater-actions";
import { bulkAction } from "../components/bulk";
import { FilterChips } from "../components/filter-chips";
import { type Column, ListPage } from "../components/list-page";
import { Status } from "../components/status";
import { useImageUpdaterStores } from "../hooks/use-image-updater-stores";
import { APPLICATIONS_PAGE } from "../pages/applications-page";
import { ago } from "./cells";
import { RuleDrawer } from "./rule-drawer";

const keyOf = (row: RuleRow) => keyFor(row.updater.getName(), row.updater.getNs());

export interface RulesParams {
  name?: { get(): string };
  namespace?: { get(): string };
  filter?: { get(): string };
}

const FILTER_LABELS: Record<RuleFilter, string> = { attention: "Need attention" };
const FILTER_TITLES: Record<RuleFilter, string> = {
  attention: "Shows the rules that are failing or need a look",
};

export const ImageUpdaterRulesPage = observer(
  ({ extension, params }: { extension: Renderer.LensExtension; params?: RulesParams }) => {
    const { updaters, applications, state, gap } = useImageUpdaterStores();
    const named = namedKey(params?.name?.get(), params?.namespace?.get());
    const [selectedKey, setSelectedKey] = useState(named);
    const requested = filterNamed(RULE_FILTERS, params?.filter?.get());
    const [filter, setFilter] = useState<RuleFilter | undefined>(requested);

    // The page stays mounted when a card names another filter.
    useEffect(() => setFilter(requested), [requested]);

    // A link elsewhere names a rule: its drawer opens, even with the page already mounted.
    useEffect(() => {
      if (named) setSelectedKey(named);
    }, [named]);
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
        alarm={state === "unreachable" ? describeRulesState(state) : gap}
        section="image-updater-rules"
        rows={applyFilter(ranked, RULE_FILTERS, filter)}
        filters={
          ranked.length > 0 && (
            <FilterChips
              filters={Object.keys(RULE_FILTERS) as RuleFilter[]}
              labels={FILTER_LABELS}
              titles={FILTER_TITLES}
              counts={{ attention: applyFilter(ranked, RULE_FILTERS, "attention").length }}
              current={filter}
              onChange={setFilter}
              section="image-updater-rule-filters"
            />
          )
        }
        columns={columns}
        keyOf={keyOf}
        searchTexts={ruleSearchTexts}
        onOpen={(row) => setSelectedKey(keyOf(row))}
        selection={{
          hint: "Deleting a rule stops its images being updated; the Applications keep the tags they run now.",
          actions: [
            bulkAction<RuleRow>({
              label: "Delete",
              done: "Deleted",
              kind: "rule",
              tooltip: "Deletes each ticked rule, so its images stop being updated.",
              caution: true,
              nameOf: (row) => row.updater.getName(),
              detail:
                "Their images stop being updated. The Applications keep the tags they run now.",
              run: (row) => deleteRule(row.updater),
            }),
          ],
        }}
        empty={emptyText(
          state,
          describeRulesState,
          ranked.length > 0
            ? "No rule matches that filter."
            : "No ImageUpdater rules in the namespaces in scope.",
        )}
      >
        <RuleDrawer
          updater={selected?.updater}
          health={selected?.health}
          applications={applications}
          onClose={() => setSelectedKey(undefined)}
          onOpenApplication={(name) => {
            setSelectedKey(undefined);
            void extension.navigate(APPLICATIONS_PAGE, {
              name,
              namespace: selected?.updater.getNs() ?? "",
            });
          }}
        />
      </ListPage>
    );
  },
);
