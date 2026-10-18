import type { Application } from "../api/applications/application";
import { describeRefresh, listNames, refreshEach, syncEach } from "../api/writes/bulk";
import type { RefreshMode, SyncChoice } from "../api/writes/patches";
import { notifyBulkOutcome } from "./bulk";
import { confirmWrite } from "./confirm";
import { SelectionBar } from "./selection-bar";
import { describeSyncChoice, SyncChoices } from "./sync-choices";

function confirmRefresh(targets: Application[], mode: RefreshMode) {
  confirmWrite({
    ...describeRefresh(
      targets.map((application) => application.getName()),
      mode,
    ),
    destructive: false,
    ok: async () =>
      notifyBulkOutcome(
        mode === "hard" ? "Requested a hard refresh of" : "Requested a refresh of",
        await refreshEach(targets, mode),
      ),
  });
}

/** The choice reaches ok through a callback: the dialog copies its message's props. */
function confirmSync(targets: Application[]) {
  let choice: SyncChoice = { prune: false, force: false };

  confirmWrite({
    question: (
      <>
        Sync the <b>{targets.length}</b> selected Application{targets.length === 1 ? "" : "s"}?
      </>
    ),
    detail: `${listNames(targets.map((application) => application.getName()))}. ArgoCD will apply what is in git to each one.`,
    form: (
      <SyncChoices
        onChange={(picked) => {
          choice = picked;
        }}
      />
    ),
    label: `Sync ${targets.length}`,
    destructive: true,
    typed: () => "confirm",
    ok: async () =>
      notifyBulkOutcome(
        `Started a sync${describeSyncChoice(choice)} on`,
        await syncEach(targets, choice),
      ),
  });
}

interface SelectionActionsProps {
  /** The rows shown after the search; a selection hidden by the search is not acted on. */
  getItems: () => Application[];
  pickOnlySelected: (items: Application[]) => Application[];
}

export function SelectionActions({ getItems, pickOnlySelected }: SelectionActionsProps) {
  return (
    <SelectionBar
      getItems={getItems}
      pickOnlySelected={pickOnlySelected}
      hint="Refresh compares with git again; hard refresh also regenerates the manifests. Neither changes the cluster or prunes anything: only Sync does, and prune and force are choices there."
      actions={[
        {
          label: "Refresh",
          tooltip:
            "Asks ArgoCD to compare each one with git again. Changes nothing in the cluster. Asks first.",
          run: (targets) => confirmRefresh(targets, "normal"),
        },
        {
          label: "Hard refresh",
          tooltip:
            "Refreshes, and also drops the manifests ArgoCD has cached, so they are generated again. Asks first.",
          run: (targets) => confirmRefresh(targets, "hard"),
        },
        {
          label: "Sync",
          tooltip:
            "Applies what is in git to each one. Asks first, offers prune, and asks you to type confirm.",
          caution: true,
          run: confirmSync,
        },
      ]}
    />
  );
}
