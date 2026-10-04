import type { AppProject } from "../api/app-project";
import { type BulkOutcome, planFor, projectRefusal } from "../api/bulk";
import type { SyncChoice } from "../api/patches";
import {
  applicationsOf,
  refreshProjectApplications,
  setFrozen,
  syncProjectApplications,
} from "../api/project-actions";
import { bulkAction, confirmBulk } from "./bulk";
import { SelectionBar } from "./selection-bar";
import { SyncChoices } from "./sync-choices";

const nameOf = (project: AppProject) => project.getName();
const countApplications = (project: AppProject) => applicationsOf(project).length;

/** A project counts as failed when any of its Applications did. */
async function each(outcome: Promise<BulkOutcome>): Promise<void> {
  const { failures } = await outcome;

  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.applicationName).join(", "));
  }
}

interface ProjectSelectionActionsProps {
  getItems: () => AppProject[];
  pickOnlySelected: (items: AppProject[]) => AppProject[];
}

export function ProjectSelectionActions({
  getItems,
  pickOnlySelected,
}: ProjectSelectionActionsProps) {
  return (
    <SelectionBar
      getItems={getItems}
      pickOnlySelected={pickOnlySelected}
      hint="Refresh and sync act on every Application of each project. Freeze adds a deny sync window; Resume removes it."
      actions={[
        {
          label: "Refresh all",
          tooltip:
            "Compares every Application of each project with git again. Changes nothing in the cluster. Asks first",
          run: (picked) =>
            confirmBulk({
              nameOf,
              verb: "Refresh",
              done: "Refreshed",
              kind: "project",
              plan: planFor(picked, projectRefusal("refresh", countApplications)),
              detail:
                "ArgoCD compares each of their Applications with git again and applies nothing.",
              destructive: false,
              typed: false,
              run: (project) => each(refreshProjectApplications(project)),
            }),
        },
        {
          label: "Sync all",
          tooltip:
            'Applies git to every Application of each project. Offers prune and asks you to type "confirm"',
          caution: true,
          run: (picked) => {
            let choice: SyncChoice = { prune: false, force: false };

            confirmBulk({
              nameOf,
              verb: "Sync",
              done: "Started syncing",
              kind: "project",
              plan: planFor(picked, projectRefusal("sync", countApplications)),
              detail: "ArgoCD applies what is in git to each of their Applications.",
              form: (
                <SyncChoices
                  onChange={(next) => {
                    choice = next;
                  }}
                />
              ),
              destructive: true,
              run: (project) => each(syncProjectApplications(project, choice)),
            });
          },
        },
        bulkAction<AppProject>({
          label: "Freeze",
          done: "Froze",
          kind: "project",
          tooltip:
            "Adds a deny sync window to each project, so ArgoCD stops syncing its Applications.",
          caution: true,
          nameOf,
          refuse: projectRefusal("freeze", countApplications),
          detail: "Nothing already running is rolled back.",
          run: (project) => setFrozen(project, true),
        }),
        bulkAction<AppProject>({
          label: "Resume",
          done: "Resumed",
          kind: "project",
          tooltip: "Removes the deny sync window from each project, so ArgoCD syncs it again.",
          nameOf,
          refuse: projectRefusal("resume", countApplications),
          run: (project) => setFrozen(project, false),
        }),
      ]}
    />
  );
}
