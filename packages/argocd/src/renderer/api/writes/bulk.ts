import type { Application } from "../applications/application";
import type { AppProject } from "../projects/app-project";
import { isFrozen } from "../projects/freeze";
import { reasonOf } from "../shared/errors";
import { plural } from "../shared/text";
import { refreshApplication, syncApplication } from "./actions";
import { operationRefusal, type RefreshMode, type SyncChoice } from "./patches";

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
  /** Not attempted, with why. */
  skipped?: FailedApplication[];
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
          reason: reasonOf(error),
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

export async function syncEach(
  applications: Application[],
  { prune = false, force = false }: Partial<SyncChoice> = {},
): Promise<BulkOutcome> {
  const { ready, skipped } = planFor(applications, operationRefusal);
  const outcome = await applyToEachApplication(ready, (application) =>
    syncApplication(application, { prune, force }),
  );

  if (skipped.length === 0) return outcome;

  return {
    ...outcome,
    skipped: skipped.map(({ item, reason }) => ({ applicationName: item.getName(), reason })),
  };
}

const MAX_NAMES_IN_SENTENCE = 3;

function firstNames(failures: FailedApplication[]): string {
  const named = failures
    .slice(0, MAX_NAMES_IN_SENTENCE)
    .map((failure) => failure.applicationName)
    .join(", ");

  return `${named}${failures.length > MAX_NAMES_IN_SENTENCE ? "…" : ""}`;
}

export function describeBulkOutcome(pastTenseVerb: string, outcome: BulkOutcome): string {
  const { succeeded, failures, skipped = [] } = outcome;
  const done =
    failures.length === 0
      ? `${pastTenseVerb} ${plural(succeeded, "Application")}.`
      : `${pastTenseVerb} ${succeeded}, failed on ${failures.length}: ${firstNames(failures)}`;

  if (skipped.length === 0) return done;

  const busy = `Skipped ${skipped.length} with an operation already running`;

  return `${done}${done.endsWith(".") ? "" : "."} ${busy}: ${firstNames(skipped)}.`;
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

/** A failed item with what went wrong. */
export function failureOf(name: string, error: unknown): string {
  return `${name} (${reasonOf(error)})`;
}

export function describeOutcome(verb: string, done: number, failed: string[]): string {
  const what = `${verb} ${done} of ${done + failed.length}.`;

  // A failure's own message can list names with commas.
  return failed.length === 0 ? what : `${what} Failed: ${failed.join("; ")}.`;
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

/** A refresh changes nothing in the cluster, so it asks first but wants no typed word. */
export function describeRefresh(names: string[], mode: RefreshMode) {
  const verb = mode === "hard" ? "Hard refresh" : "Refresh";
  const many = names.length !== 1;
  const what =
    mode === "hard"
      ? "drops the manifests it cached, generates them again and compares"
      : "compares";

  return {
    question: many ? `${verb} the ${names.length} selected Applications?` : `${verb} ${names[0]}?`,
    detail: `${many ? `${listNames(names)}. ` : ""}ArgoCD ${what} ${many ? "each one" : "it"} with git again. Nothing in the cluster changes.`,
    label: many ? `${verb} ${names.length}` : verb,
  };
}
