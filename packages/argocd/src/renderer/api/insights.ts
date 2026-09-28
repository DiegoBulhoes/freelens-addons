import { Application } from "./application";
import type { DeployEntry } from "./overview";
import { findGitRevision, revisionsOfDeploy } from "./revisions";

/**
 * The parent of each of these Applications, found in one pass over the fleet.
 *
 * `applications` is the rows being asked about, not the fleet, so the pass
 * stops once all of them have an answer.
 */
export function getParentsOf(
  applications: Application[],
  all: Application[],
): Map<Application, Application> {
  // Two Applications can share a name across namespaces, so a name maps to a
  // list and the namespace rule below decides between them.
  const wanted = new Map<string | undefined, Application[]>();

  for (const application of applications) {
    const sharing = wanted.get(application.getName());

    if (sharing) sharing.push(application);
    else wanted.set(application.getName(), [application]);
  }

  const parents = new Map<Application, Application>();
  const unanswered = new Set(applications);

  for (const candidate of all) {
    // `all` is walked in order and the first match wins, as the find() this
    // replaces did, so nothing later can change an answer.
    if (unanswered.size === 0) break;

    for (const resource of Application.getManagedResources(candidate)) {
      if (resource.kind !== "Application") continue;

      for (const application of wanted.get(resource.name) ?? []) {
        if (candidate === application) continue;
        if (!unanswered.has(application)) continue;

        const namespace = application.getNs();

        // Written as the comparison rather than a bucket test on purpose: `??`
        // falls back on null as well as undefined, and `=== undefined` would
        // quietly disagree with the scan.
        if ((resource.namespace ?? namespace) !== namespace) continue;

        parents.set(application, candidate);
        unanswered.delete(application);
      }
    }
  }

  return parents;
}

/** The Application that manages this one, in an app-of-apps layout. */
export function getParentOf(application: Application, all: Application[]): Application | undefined {
  return getParentsOf([application], all).get(application);
}

export function getChildrenOf(application: Application, all: Application[]): Application[] {
  const managed = new Set(
    Application.getManagedResources(application)
      .filter((resource) => resource.kind === "Application" && resource.name)
      .map((resource) => resource.name as string),
  );

  return managed.size === 0 ? [] : all.filter((candidate) => managed.has(candidate.getName()));
}

export interface DeployCohort {
  revision: string;
  at: number;
  entries: DeployEntry[];
}

export function groupDeploysByRevision(deploys: DeployEntry[]): DeployCohort[] {
  const cohorts = new Map<string, DeployCohort>();

  for (const entry of deploys) {
    const revision = findGitRevision(entry.revisions) ?? entry.revisions[0] ?? "—";
    const existing = cohorts.get(revision);

    if (existing) {
      existing.entries.push(entry);
      existing.at = Math.max(existing.at, entry.at);
    } else {
      cohorts.set(revision, { revision, at: entry.at, entries: [entry] });
    }
  }

  return [...cohorts.values()].sort((first, second) => second.at - first.at);
}

export function getCompareUrl(application: Application): string | undefined {
  const history = application.status?.history ?? [];

  if (history.length < 2) return undefined;

  const current = history[history.length - 1];
  const previous = history[history.length - 2];

  const previousRevision = findGitRevision(revisionsOfDeploy(previous));
  const currentRevision = findGitRevision(revisionsOfDeploy(current));

  if (!previousRevision || !currentRevision || previousRevision === currentRevision) {
    return undefined;
  }

  const repo = Application.getSources(application)
    .map((source) => source.repoURL)
    .find((url) => url && /github\.com|gitlab\.com/.test(url));

  if (!repo) return undefined;

  const web = toWebUrl(repo);

  if (!web) return undefined;

  return `${web}/compare/${previousRevision}...${currentRevision}`;
}

function toWebUrl(repoURL: string): string | undefined {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(repoURL);

  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;

  const https = /^https?:\/\/(.+?)(?:\.git)?$/.exec(repoURL);

  return https ? `https://${https[1]}` : undefined;
}
