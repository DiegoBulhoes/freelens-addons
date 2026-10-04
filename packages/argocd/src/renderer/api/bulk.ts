import { refreshApplication, syncApplication } from "./actions";
import type { AppProject } from "./app-project";
import type { Application } from "./application";
import { isFrozen, type RefreshMode } from "./patches";

const MAX_CONCURRENT_REQUESTS = 4;

async function runWithLimitedConcurrency<Item>(
  items: Item[],
  handleItem: (item: Item) => Promise<void>,
  maxConcurrent: number,
): Promise<void> {
  const queue = [...items];

  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await handleItem(next);
    }
  };

  const workerCount = Math.min(maxConcurrent, queue.length);

  await Promise.all(Array.from({ length: workerCount }, worker));
}

export interface FailedApplication {
  applicationName: string;
  reason: string;
}

export interface BulkOutcome {
  succeeded: number;
  failures: FailedApplication[];
}

export async function applyToEachApplication(
  applications: Application[],
  applyToOne: (application: Application) => Promise<void>,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { succeeded: 0, failures: [] };

  await runWithLimitedConcurrency(
    applications,
    async (application) => {
      try {
        await applyToOne(application);
        outcome.succeeded += 1;
      } catch (error) {
        outcome.failures.push({
          applicationName: application.getName(),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    MAX_CONCURRENT_REQUESTS,
  );

  return outcome;
}

export function refreshEach(
  applications: Application[],
  mode: RefreshMode = "normal",
): Promise<BulkOutcome> {
  return applyToEachApplication(applications, (application) =>
    refreshApplication(application, mode),
  );
}

export function syncEach(
  applications: Application[],
  { prune = false, force = false }: { prune?: boolean; force?: boolean } = {},
): Promise<BulkOutcome> {
  return applyToEachApplication(applications, (application) =>
    syncApplication(application, { prune, force }),
  );
}

const MAX_NAMES_IN_SENTENCE = 3;

export function describeOutcome(pastTenseVerb: string, outcome: BulkOutcome): string {
  const { succeeded, failures } = outcome;

  if (failures.length === 0) {
    return `${pastTenseVerb} ${succeeded} Application${succeeded === 1 ? "" : "s"}.`;
  }

  const named = failures
    .slice(0, MAX_NAMES_IN_SENTENCE)
    .map((failure) => failure.applicationName)
    .join(", ");
  const trailing = failures.length > MAX_NAMES_IN_SENTENCE ? "…" : "";

  return `${pastTenseVerb} ${succeeded}, failed on ${failures.length}: ${named}${trailing}`;
}

export function listNames(names: string[], shown = 6): string {
  if (names.length <= shown) {
    if (names.length <= 1) return names.join("");

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

export interface Plan<Item> {
  ready: Item[];
  skipped: { item: Item; reason: string }[];
}

/** Splits a selection into what an action applies to and what it would refuse, with why. */
export function planFor<Item>(
  items: Item[],
  refuse: (item: Item) => string | undefined,
): Plan<Item> {
  const plan: Plan<Item> = { ready: [], skipped: [] };

  for (const item of items) {
    const reason = refuse(item);

    if (reason) plan.skipped.push({ item, reason });
    else plan.ready.push(item);
  }

  return plan;
}

export function describeEachOutcome(verb: string, done: number, failed: string[]): string {
  const what = `${verb} ${done} of ${done + failed.length}.`;

  return failed.length === 0 ? what : `${what} Failed: ${failed.join(", ")}.`;
}

export type ProjectBulk = "refresh" | "sync" | "freeze" | "resume";

export function projectRefusal(
  action: ProjectBulk,
  countApplications: (project: AppProject) => number,
) {
  return (project: AppProject): string | undefined => {
    if (action === "freeze") return isFrozen(project) ? "already frozen" : undefined;
    if (action === "resume") return isFrozen(project) ? undefined : "not frozen";

    return countApplications(project) === 0 ? "it has no Applications" : undefined;
  };
}
