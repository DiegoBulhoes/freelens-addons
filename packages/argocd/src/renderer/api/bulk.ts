import { refreshApplication, syncApplication } from "./actions";
import type { Application } from "./application";
import type { RefreshMode } from "./patches";

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
  { prune = false }: { prune?: boolean } = {},
): Promise<BulkOutcome> {
  return applyToEachApplication(applications, (application) =>
    syncApplication(application, { prune }),
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
