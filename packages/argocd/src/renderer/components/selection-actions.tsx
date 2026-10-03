import { Renderer } from "@freelensapp/extensions";

import type { Application } from "../api/application";
import { type BulkOutcome, describeOutcome, listNames, refreshEach, syncEach } from "../api/bulk";
import type { RefreshMode, SyncChoice } from "../api/patches";
import { confirmWrite } from "./confirm";
import { SelectionBar } from "./selection-bar";
import { describeChoice, SyncChoices } from "./sync-choices";

const {
  Component: { Notifications },
} = Renderer;

function report(pastTenseVerb: string, outcome: BulkOutcome) {
  const sentence = describeOutcome(pastTenseVerb, outcome);

  if (outcome.failures.length === 0) Notifications.ok(sentence);
  else Notifications.error(sentence);
}

// No confirmation: a refresh changes nothing in the cluster.
async function refresh(targets: Application[], mode: RefreshMode) {
  report(
    mode === "hard" ? "Requested a hard refresh of" : "Requested a refresh of",
    await refreshEach(targets, mode),
  );
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
      report(`Started a sync${describeChoice(choice)} on`, await syncEach(targets, choice)),
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
            "Asks ArgoCD to compare each one with git again. Changes nothing in the cluster.",
          run: (targets) => void refresh(targets, "normal"),
        },
        {
          label: "Hard refresh",
          tooltip:
            "Refreshes, and also drops the manifests ArgoCD has cached, so they are generated again.",
          run: (targets) => void refresh(targets, "hard"),
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
