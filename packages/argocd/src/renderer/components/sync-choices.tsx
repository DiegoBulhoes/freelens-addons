import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";

import { isRiskyChoice, type SyncChoice } from "../api/patches";
import { TypedField } from "./confirm";

const {
  Component: { Checkbox },
} = Renderer;

export function describeChoice({ prune, force }: SyncChoice): string {
  const picked = [prune && "prune", force && "force"].filter(Boolean);

  return picked.length === 0 ? "" : ` with ${picked.join(" and ")}`;
}

/** The choice reaches ok through `onChange`, never a shared object: ConfirmDialog copies its message's props. */
export function SyncChoices({
  onChange,
  typedName,
  onType,
}: {
  onChange: (choice: SyncChoice) => void;
  typedName?: string;
  onType?: (text: string) => void;
}) {
  const [choice, setChoice] = useState<SyncChoice>({ prune: false, force: false });
  const update = (next: Partial<SyncChoice>) => {
    const updated = { ...choice, ...next };

    setChoice(updated);
    onChange(updated);
  };

  return (
    <div className="ArgoCD-form">
      <Checkbox
        label="Prune: also delete resources that are no longer in git"
        value={choice.prune}
        onChange={(value: boolean) => update({ prune: value })}
      />
      <Checkbox
        label="Force: delete and recreate each resource instead of applying over it"
        value={Boolean(choice.force)}
        onChange={(value: boolean) => update({ force: value })}
      />
      {choice.force && (
        <p className="ArgoCD-text--critical">
          Each resource is removed at once, without graceful deletion, and created again: pods
          restart, and anything only the old object held is lost. Use it for a change an apply
          cannot make, such as an immutable field.
        </p>
      )}
      {typedName && onType && isRiskyChoice(choice) && (
        <TypedField expected={typedName} onType={onType} />
      )}
    </div>
  );
}
