import type { RevisionHistory } from "./types";

/** 7 is git's default abbreviation and the shortest form ArgoCD writes; 40 is the full hash. */
const GIT_REVISION_PATTERN = /^[0-9a-f]{7,40}$/;

const FULL_GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export function isGitRevision(candidate: string): boolean {
  return GIT_REVISION_PATTERN.test(candidate);
}

/** A multi-source deploy records `revisions` in source order; a single-source one, `revision`. */
export function revisionsOfDeploy(deploy: RevisionHistory | undefined): string[] {
  if (!deploy) return [];

  const recorded = deploy.revisions ?? (deploy.revision ? [deploy.revision] : []);

  return recorded.filter(Boolean);
}

/** A multi-source revision list mixes chart versions in with the commit. */
export function findGitRevision(revisions: string[]): string | undefined {
  return revisions.find(isGitRevision);
}

export function shortenRevision(revision: string): string {
  return FULL_GIT_REVISION_PATTERN.test(revision) ? revision.slice(0, 7) : revision;
}
