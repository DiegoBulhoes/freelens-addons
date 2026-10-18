import { keyFor } from "../shared/identity";
import type { TrackedImage, UpdateRow, WatchedApplication } from "./image-updates";
import { type RuleRow, stateRank } from "./rule-health";

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

export function describePicks(image: TrackedImage): string {
  const within = image.constraint ? ` within ${image.constraint}` : "";
  const tags = image.allowTags ? `, tags matching ${image.allowTags}` : "";

  return `${image.strategy}${within}${tags}`;
}

export const MAX_PICKS_SHOWN = 32;

/** The Picks cell is nowrap, so a long tag filter would push the row menu off the page. */
export function picksCell(image: TrackedImage): { label: string; title: string } {
  const full = describePicks(image);

  return {
    label: full.length > MAX_PICKS_SHOWN ? `${full.slice(0, MAX_PICKS_SHOWN - 1)}…` : full,
    title: full,
  };
}

export type ApplicationsCell =
  | { kind: "none" }
  | { kind: "one"; watched: WatchedApplication }
  | { kind: "many"; count: number; title: string };

export function watchedStatus(watched: WatchedApplication): string {
  return watched.skipped ? "skipped" : (watched.running ?? "not running it");
}

function describeWatched(watched: WatchedApplication): string {
  if (watched.skipped) return `${watched.name}: skipped, ${watched.skipped}`;

  return `${watched.name}: ${watchedStatus(watched)}`;
}

export function applicationsCell(image: TrackedImage): ApplicationsCell {
  const [first, ...rest] = image.applications;

  if (!first) return { kind: "none" };
  if (rest.length === 0) return { kind: "one", watched: first };

  const lines = image.applications.map(describeWatched);

  return {
    kind: "many",
    count: image.applications.length,
    title: [...lines, "The row opens the image, with a link to each."].join("\n"),
  };
}

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

export function imageKey(image: TrackedImage): string {
  return `${image.namespace}/${image.updater}/${image.alias}/${image.applications
    .map((watched) => watched.name)
    .join(",")}`;
}

export function updateKey(update: UpdateRow): string {
  return `${update.namespace}/${update.updater}/${update.alias}/${update.to}`;
}

export function findRule(
  rows: RuleRow[],
  name: string,
  namespace: string | undefined,
): RuleRow | undefined {
  const wanted = keyFor(name, namespace);

  return rows.find((row) => keyFor(row.updater.getName(), row.updater.getNs()) === wanted);
}
