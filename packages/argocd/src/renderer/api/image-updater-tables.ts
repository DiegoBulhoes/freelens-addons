import { type RuleRow, stateRank, type TrackedImage, type UpdateRow } from "./image-updates";

type SortValue = string | number | undefined;

/** Most recent first when ascending, as "4m ago" reads before "2h ago". */
function recency(timestamp: string | undefined): number | undefined {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isNaN(parsed) ? undefined : -parsed;
}

export const RULE_COLUMNS = {
  rule: "Rule",
  state: "State",
  applications: "Applications",
  images: "Images",
  checked: "Checked",
  lastUpdate: "Last update",
} as const;

export const RULE_SORT: Record<string, (row: RuleRow) => SortValue> = {
  [RULE_COLUMNS.rule]: (row) => row.updater.getName(),
  [RULE_COLUMNS.state]: (row) => stateRank(row.health.state),
  [RULE_COLUMNS.applications]: (row) => row.updater.status?.applicationsMatched,
  [RULE_COLUMNS.images]: (row) => row.updater.status?.imagesManaged,
  [RULE_COLUMNS.checked]: (row) => recency(row.updater.status?.lastCheckedAt),
  [RULE_COLUMNS.lastUpdate]: (row) => recency(row.updater.status?.lastUpdatedAt),
};

export function ruleSearchTexts(row: RuleRow): string[] {
  return [row.updater.getName(), row.updater.getNs() ?? "", row.health.label];
}

export const IMAGE_COLUMNS = {
  image: "Image",
  picks: "Picks",
  applications: "Applications, running now",
  writesTo: "Writes to",
  rule: "Rule",
} as const;

export const IMAGE_SORT: Record<string, (image: TrackedImage) => SortValue> = {
  [IMAGE_COLUMNS.image]: (image) => image.alias,
  [IMAGE_COLUMNS.picks]: (image) => image.strategy,
  [IMAGE_COLUMNS.applications]: (image) => image.applications.length,
  [IMAGE_COLUMNS.writesTo]: (image) => (image.writesToGit ? "git" : "Application"),
  [IMAGE_COLUMNS.rule]: (image) => image.updater,
};

export function imageSearchTexts(image: TrackedImage): string[] {
  return [
    image.alias,
    image.repository,
    image.updater,
    image.namespace,
    ...image.applications.map((watched) => watched.name),
  ];
}

export const UPDATE_COLUMNS = {
  when: "When",
  image: "Image",
  from: "From",
  to: "To",
  applications: "Applications",
  rule: "Rule",
} as const;

export const UPDATE_SORT: Record<string, (update: UpdateRow) => SortValue> = {
  [UPDATE_COLUMNS.when]: (update) => recency(update.at),
  [UPDATE_COLUMNS.image]: (update) => update.alias,
  [UPDATE_COLUMNS.from]: (update) => update.from,
  [UPDATE_COLUMNS.to]: (update) => update.to,
  [UPDATE_COLUMNS.applications]: (update) => update.applications,
  [UPDATE_COLUMNS.rule]: (update) => update.updater,
};

export function updateSearchTexts(update: UpdateRow): string[] {
  return [update.alias, update.image, update.from ?? "", update.to, update.updater];
}

export function ruleKey(name: string, namespace: string | undefined): string {
  return `${namespace ?? ""}/${name}`;
}
