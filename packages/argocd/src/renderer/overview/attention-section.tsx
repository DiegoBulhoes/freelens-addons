import type { Application } from "../api/application";
import { FILTER_LABELS, type FilterKey, filterChips, type Page } from "../api/attention-filter";
import { idOf } from "../api/identity";
import { getParentsOf } from "../api/insights";
import type { AttentionItem } from "../api/overview";
import { AttentionRow } from "./attention-row";

export function AttentionSection({
  attention,
  ordered,
  currentPage,
  applications,
  filter,
  searchText,
  pinnedIds,
  isWorking,
  onFilterChange,
  onSearchChange,
  onPageChange,
  onMarksChanged,
  onRefreshAll,
  onSyncAll,
  onOpen,
}: {
  attention: AttentionItem[];
  ordered: AttentionItem[];
  currentPage: Page<AttentionItem>;
  applications: Application[];
  filter: FilterKey;
  searchText: string;
  pinnedIds: Set<string>;
  isWorking: boolean;
  onFilterChange: (filter: FilterKey) => void;
  onSearchChange: (searchText: string) => void;
  onPageChange: (pageIndex: number) => void;
  onMarksChanged: () => void;
  onRefreshAll: () => void;
  onSyncAll: () => void;
  onOpen: (application: Application) => void;
}) {
  // One pass for the page instead of a fleet scan per row. Not memoised: once the store resolves,
  // `applications` is a mobx array whose identity survives every `.replace()`, so a useMemo keyed
  // on it would compute once against the empty array useArgoCDStores returns before then and never
  // again, dropping every "managed by" label.
  const parents = getParentsOf(
    currentPage.items.map((item) => item.application),
    applications,
  );

  return (
    <section className="ArgoCD-section" data-section="attention">
      <div className="ArgoCD-section__bar">
        <h2 className="ArgoCD-section__title">Needs attention</h2>

        <div className="ArgoCD-filters">
          {filterChips(attention, filter, pinnedIds).map(({ key, total }) => (
            <button
              key={key}
              type="button"
              className="ArgoCD-filter"
              aria-pressed={filter === key}
              onClick={() => onFilterChange(key)}
            >
              {FILTER_LABELS[key]}
              <span className="ArgoCD-filter__count">{total}</span>
            </button>
          ))}
        </div>

        <input
          className="ArgoCD-search ArgoCD-search--wide"
          type="search"
          value={searchText}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter by name, project or destination"
        />

        {ordered.length > 1 && (
          <div className="ArgoCD-actions">
            <button
              type="button"
              className="ArgoCD-button"
              disabled={isWorking}
              onClick={onRefreshAll}
            >
              Refresh {ordered.length}
            </button>
            <button
              type="button"
              className="ArgoCD-button ArgoCD-button--caution"
              disabled={isWorking}
              onClick={onSyncAll}
            >
              Sync {ordered.length}
            </button>
          </div>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="ArgoCD-section__note">Nothing matches this filter.</p>
      ) : (
        <div className="ArgoCD-list">
          {currentPage.items.map((item) => (
            <AttentionRow
              key={item.application.getId()}
              item={item}
              parent={parents.get(item.application)}
              pinned={pinnedIds.has(idOf(item.application))}
              onChanged={onMarksChanged}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      {currentPage.pageCount > 1 && (
        <div className="ArgoCD-section__bar">
          <span className="ArgoCD-muted">
            {currentPage.firstItemNumber}–{currentPage.lastItemNumber} of {ordered.length}
          </span>
          <div className="ArgoCD-actions">
            <button
              type="button"
              className="ArgoCD-button"
              disabled={currentPage.pageIndex === 0}
              onClick={() => onPageChange(currentPage.pageIndex - 1)}
            >
              ‹ Previous
            </button>
            <button
              type="button"
              className="ArgoCD-button"
              disabled={currentPage.pageIndex >= currentPage.pageCount - 1}
              onClick={() => onPageChange(currentPage.pageIndex + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
