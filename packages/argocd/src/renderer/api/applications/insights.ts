import type { DeployEntry } from "../overview/overview";
import { Application } from "./application";
import { findGitRevision, revisionsOfDeploy } from "./revisions";

export interface ParentIndex {
  parentOf(application: Application): Application | undefined;
}

/** Built once per fleet, so each row shown is a lookup instead of a scan of every Application. */
export function indexParents(all: Application[]): ParentIndex {
  // The namespace each managing entry names; absent or null matches the child's own.
  const claims = new Map<string, { candidate: Application; namespace?: string | null }[]>();

  for (const candidate of all) {
    for (const resource of Application.getManagedResources(candidate)) {
      if (resource.kind !== "Application" || !resource.name) continue;

      const claim = { candidate, namespace: resource.namespace };
      const named = claims.get(resource.name);

      if (named) named.push(claim);
      else claims.set(resource.name, [claim]);
    }
  }

  return {
    parentOf: (application) => {
      const namespace = application.getNs();

      for (const claim of claims.get(application.getName()) ?? []) {
        if (claim.candidate !== application && (claim.namespace ?? namespace) === namespace) {
          return claim.candidate;
        }
      }

      return undefined;
    },
  };
}

export function getParentOf(application: Application, all: Application[]): Application | undefined {
  return indexParents(all).parentOf(application);
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
