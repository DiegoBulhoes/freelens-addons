import { Application } from "./application";
import { isGitRevision } from "./revisions";
import type { ApplicationSource } from "./types";

const MOVING_REFS = new Set(["", "head", "main", "master", "trunk", "develop", "latest"]);

const SEMVER_TAG = /^v?\d+\.\d+(\.\d+)?(-[\w.]+)?$/;
/** Helm version ranges: `^1.2.0`, `~1.2`, `1.2.*`, `>=1.0 <2.0`. */
const VERSION_RANGE = /[\^~*x><|]|\s-\s/;

export type SourceKind = "branch" | "range" | "pinned";

export function classifySource(source: ApplicationSource): SourceKind {
  const revision = (source.targetRevision ?? "").trim();

  if (isGitRevision(revision)) return "pinned";
  if (SEMVER_TAG.test(revision)) return "pinned";
  if (VERSION_RANGE.test(revision)) return "range";
  if (MOVING_REFS.has(revision.toLowerCase())) return "branch";

  // An unrecognised ref is a named branch: still moving, never pinned.
  return "branch";
}

export interface SourceGroup {
  repoURL: string;
  targetRevision: string;
  kind: SourceKind;
  chart?: string;
  applications: Application[];
}

export interface SourceExposure {
  moving: SourceGroup[];
  pinned: number;
  exposed: number;
  total: number;
}

/** `path` is deliberately out of the key: every path of one repo at `main` moves together. */
function groupKeyOf(source: ApplicationSource): string {
  return [source.repoURL ?? "", source.chart ?? "", source.targetRevision ?? ""].join("|");
}

function referenceLabelOf(source: ApplicationSource): string {
  return (source.targetRevision ?? "").trim() || "HEAD";
}

function hasRepository(source: ApplicationSource): boolean {
  return Boolean(source.repoURL);
}

function addToGroup(
  groups: Map<string, SourceGroup>,
  source: ApplicationSource,
  application: Application,
): void {
  const key = groupKeyOf(source);
  const existing = groups.get(key);

  if (!existing) {
    groups.set(key, {
      repoURL: source.repoURL as string,
      targetRevision: referenceLabelOf(source),
      kind: classifySource(source),
      chart: source.chart,
      applications: [application],
    });

    return;
  }

  // A multi-source Application can reach the same group twice.
  if (!existing.applications.includes(application)) existing.applications.push(application);
}

function compareByBlastRadius(first: SourceGroup, second: SourceGroup): number {
  const byApplicationCount = second.applications.length - first.applications.length;

  if (byApplicationCount !== 0) return byApplicationCount;

  return first.repoURL.localeCompare(second.repoURL);
}

export function getSourceExposure(applications: Application[]): SourceExposure {
  const movingGroups = new Map<string, SourceGroup>();
  const exposedApplications = new Set<Application>();
  let pinnedSourceCount = 0;

  for (const application of applications) {
    for (const source of Application.getSources(application).filter(hasRepository)) {
      if (classifySource(source) === "pinned") {
        pinnedSourceCount += 1;
        continue;
      }

      exposedApplications.add(application);
      addToGroup(movingGroups, source, application);
    }
  }

  return {
    moving: [...movingGroups.values()].sort(compareByBlastRadius),
    pinned: pinnedSourceCount,
    exposed: exposedApplications.size,
    total: applications.length,
  };
}

export function shortenRepo(repoURL: string): string {
  return repoURL
    .replace(/^git@([^:]+):/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.git$/, "");
}
