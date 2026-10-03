import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import type { Application } from "../api/application";
import type { ImageUpdater } from "../api/image-updater";
import {
  deleteRule,
  patchApplication,
  patchRule,
  restartController,
} from "../api/image-updater-actions";
import {
  currentEdit,
  editImagePatch,
  type ImageEdit,
  type ImageLocation,
  invalidEdit,
  planUndo,
  revertEditPatch,
  STRATEGIES,
  type UndoMode,
} from "../api/image-updater-patches";
import type { UpdateRow } from "../api/image-updates";
import { confirmWrite, notifyDone } from "../components/confirm";

const {
  Component: { Input, Notifications },
} = Renderer;

// Forms report through callbacks: ConfirmDialog deep-copies object props into a MobX
// observable, so a shared object would be written to the copy. Functions are not copied.

function EditForm({ initial, onEdit }: { initial: ImageEdit; onEdit: (edit: ImageEdit) => void }) {
  const [edit, setEdit] = useState(initial);
  const change = (next: Partial<ImageEdit>) => {
    const updated = { ...edit, ...next };

    setEdit(updated);
    onEdit(updated);
  };

  return (
    <>
      <div className="ArgoCD-form__field">
        <span>Version constraint, after the colon. Empty for any tag.</span>
        <Input
          aria-label="Version constraint"
          value={edit.constraint}
          placeholder="6.14.x"
          onChange={(value: string) => change({ constraint: value.trim() })}
        />
      </div>
      <div className="ArgoCD-form__field">
        <span>How a tag is picked</span>
        <div className="ArgoCD-filters">
          {STRATEGIES.map((strategy) => (
            <button
              key={strategy}
              type="button"
              className="ArgoCD-filter"
              aria-pressed={edit.strategy === strategy}
              title={`Picks the tag by ${strategy}`}
              onClick={() => change({ strategy })}
            >
              {strategy}
            </button>
          ))}
        </div>
      </div>
      <div className="ArgoCD-form__field">
        <span>Allowed tags, a regular expression. Empty for all.</span>
        <Input
          aria-label="Allowed tags"
          value={edit.allowTags}
          placeholder="^6\.[0-9]+\.[0-9]+$"
          onChange={(value: string) => change({ allowTags: value.trim() })}
        />
      </div>
      {invalidEdit(edit) && <p className="ArgoCD-text--critical">{invalidEdit(edit)}</p>}
    </>
  );
}

function describeEdit(edit: ImageEdit): string {
  const within = edit.constraint ? ` within ${edit.constraint}` : "";
  const tags = edit.allowTags ? `, tags matching ${edit.allowTags}` : "";

  return `${edit.strategy}${within}${tags}`;
}

export function confirmEditImage(updater: ImageUpdater, location: ImageLocation): void {
  const rule = updater.getName();
  const alias = location.image.alias;
  const before = currentEdit(location);
  let draft = before;

  confirmWrite({
    question: (
      <>
        Change <b>{alias}</b> in rule <b>{rule}</b>?
      </>
    ),
    detail:
      "The controller checks the rule again as soon as it is saved, and updates the Applications if the new settings allow a newer tag.",
    form: (
      <EditForm
        initial={draft}
        onEdit={(edit) => {
          draft = edit;
        }}
      />
    ),
    label: "Save",
    destructive: false,
    ok: async () => {
      const problem = invalidEdit(draft);

      if (problem) {
        Notifications.error(`Nothing saved. ${problem}`);
        return;
      }

      const edit = draft;

      try {
        await patchRule(updater, editImagePatch(location, edit));
        notifyDone(`Changed ${alias} in ${rule} to ${describeEdit(edit)}.`, {
          done: `Put ${alias} in ${rule} back to ${describeEdit(before)}.`,
          failed: `Could not put ${alias} back. If the rule changed since the edit, nothing was written`,
          run: () => patchRule(updater, revertEditPatch(location, edit)),
        });
      } catch (error) {
        Notifications.checkedError(
          error,
          `Could not save ${alias}. If the rule changed since this page read it, nothing was written`,
        );
      }
    },
  });
}

function UndoForm({ update, onPick }: { update: UpdateRow; onPick: (mode: UndoMode) => void }) {
  const [mode, setMode] = useState<UndoMode>("pin");
  const pick = (next: UndoMode) => {
    setMode(next);
    onPick(next);
  };

  return (
    <>
      <div className="ArgoCD-filters">
        <button
          type="button"
          className="ArgoCD-filter"
          aria-pressed={mode === "pin"}
          title={`The rule allows only ${update.from} until someone edits it`}
          onClick={() => pick("pin")}
        >
          Pin to {update.from}
        </button>
        <button
          type="button"
          className="ArgoCD-filter"
          aria-pressed={mode === "skip"}
          title={`The rule ignores ${update.to} and keeps updating`}
          onClick={() => pick("skip")}
        >
          Skip {update.to} only
        </button>
      </div>
      <p className="ArgoCD-muted">
        {mode === "pin"
          ? `The rule allows only ${update.from} for this image until someone edits it. Nothing newer is picked up meanwhile.`
          : `The rule ignores ${update.to} and keeps updating. The controller may move straight to another tag the rule allows, newer than ${update.from}.`}
      </p>
    </>
  );
}

export function confirmUndo(
  updater: ImageUpdater,
  update: UpdateRow,
  applications: Application[],
): void {
  const preview = planUndo(updater, update, applications, "pin");

  if (!preview.ok) {
    Notifications.error(`Cannot undo from here. ${preview.reason}`);
    return;
  }

  const rule = updater.getName();
  let mode: UndoMode = "pin";

  confirmWrite({
    question: (
      <>
        Put <b>{update.alias}</b> back from <code>{update.to}</code> to <code>{update.from}</code>?
      </>
    ),
    detail: `On ${preview.applications.map((each) => each.application.getName()).join(", ")}. Auto-sync, where it is on, deploys it. The rule has to change too, or its next check updates the image again:`,
    form: (
      <UndoForm
        update={update}
        onPick={(picked) => {
          mode = picked;
        }}
      />
    ),
    label: "Undo",
    destructive: true,
    ok: async () => {
      const plan = planUndo(updater, update, applications, mode);

      if (!plan.ok) {
        Notifications.error(`Nothing undone. ${plan.reason}`);
        return;
      }

      try {
        // Applications first: changing the rule runs a check at once, which must find the old tag.
        for (const { application, patch } of plan.applications) {
          await patchApplication(application, patch);
        }

        await patchRule(updater, plan.rulePatch);

        notifyDone(
          mode === "pin"
            ? `Put ${update.alias} back on ${update.from}, and ${rule} now allows only that tag.`
            : `Put ${update.alias} back on ${update.from}, and ${rule} now ignores ${update.to}.`,
          {
            done: `Put ${update.alias} back on ${update.to}, and ${rule}'s settings as they were.`,
            failed: `Could not put ${update.to} back. If the rule or the Applications changed since, that part was not written`,
            // Same order, for the same reason.
            run: async () => {
              for (const { application, reverse } of plan.applications) {
                await patchApplication(application, reverse);
              }

              await patchRule(updater, plan.ruleReverse);
            },
          },
        );
      } catch (error) {
        Notifications.checkedError(error, `Could not undo ${update.alias}`);
      }
    },
  });
}

export function confirmDelete(updater: ImageUpdater, onDeleted: () => void): void {
  const name = updater.getName();

  confirmWrite({
    question: (
      <>
        Delete the rule <b>{name}</b> from <b>{updater.getNs()}</b>?
      </>
    ),
    detail: "Its images stop being updated. The Applications keep the tags they run now.",
    label: "Delete",
    destructive: true,
    typed: () => name,
    ok: async () => {
      try {
        await deleteRule(updater);
        notifyDone(`Deleted the rule ${name}.`);
        onDeleted();
      } catch (error) {
        Notifications.checkedError(error, `Could not delete ${name}`);
      }
    },
  });
}

export function confirmCheckNow(refusal: string | undefined): void {
  if (refusal) {
    Notifications.error(`Not restarted. ${refusal}`);
    return;
  }

  confirmWrite({
    question: "Restart the Image Updater controller?",
    detail:
      "It checks every rule as it starts, not only this one, and applies what it finds as it would on any check. The controller has no way to check a single rule on request.",
    label: "Restart",
    destructive: false,
    ok: async () => {
      try {
        const result = await restartController();

        if ("notFound" in result) {
          Notifications.error(
            "Could not find the controller's Deployment by its labels, so nothing was restarted.",
          );
        } else {
          notifyDone(`Restarted ${result.restarted}. It checks every rule as it starts.`);
        }
      } catch (error) {
        Notifications.checkedError(error, "Could not restart the controller");
      }
    },
  });
}
