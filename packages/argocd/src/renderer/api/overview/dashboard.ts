import type { Application } from "../applications/application";
import {
  type DeployCohort,
  groupDeploysByRevision,
  indexParents,
  type ParentIndex,
} from "../applications/insights";
import { getSourceExposure, type SourceExposure } from "../applications/sources";
import type { AppProject } from "../projects/app-project";
import {
  type AttentionItem,
  type Counts,
  getAttentionItems,
  getCounts,
  getRecentDeploys,
  getRepeatedSyncs,
  type RepeatedSync,
} from "./overview";

const MINUTE_MS = 60_000;

const RECENT_DEPLOYS_SHOWN = 40;

export interface OverviewDerivations {
  counts: Counts;
  attention: AttentionItem[];
  criticalCount: number;
  parents: ParentIndex;
  cohorts: DeployCohort[];
  repeated: RepeatedSync[];
  exposure: SourceExposure;
}

/** The clock the overview reads, to the minute, so a keystroke within the same minute reuses it. */
export function overviewMinute(now: number): number {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS;
}

/** Everything the overview derives from the whole fleet; the search and filter work on its output. */
export function deriveOverview(
  applications: Application[],
  projects: AppProject[],
  now: number,
): OverviewDerivations {
  const attention = getAttentionItems(applications, now);

  return {
    counts: getCounts(applications, projects),
    attention,
    criticalCount: attention.filter((item) => item.severity === "critical").length,
    parents: indexParents(applications),
    cohorts: groupDeploysByRevision(getRecentDeploys(applications, RECENT_DEPLOYS_SHOWN)),
    repeated: getRepeatedSyncs(applications, { now }),
    exposure: getSourceExposure(applications),
  };
}
