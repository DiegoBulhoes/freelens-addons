import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useState } from "react";

import { __Name__Styles } from "./styles";

const {
  Component: { ConfirmDialog, Input, Notifications },
} = Renderer;

export interface ConfirmWrite {
  question: ReactNode;
  detail?: ReactNode;
  /** Fields report through callbacks: the dialog copies plain-object props. */
  form?: ReactNode;
  label: string;
  destructive: boolean;
  typed?: () => string | undefined;
  ok: () => Promise<void>;
}

function TypedField({ expected, onType }: { expected: string; onType: (text: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="__Name__-form__field">
      <span>
        Type <code>{expected}</code> to confirm.
      </span>
      <Input
        aria-label="Confirmation"
        value={value}
        onChange={(next: string) => {
          setValue(next);
          onType(next);
        }}
      />
    </div>
  );
}

export function confirmWrite(write: ConfirmWrite): void {
  const expected = write.typed?.();
  let typed = "";

  ConfirmDialog.open({
    labelOk: write.label,
    okButtonProps: write.destructive ? { accent: true } : { primary: true },
    message: (
      <div className="__Name__ __Name__-dialog">
        {/* The dialog may open from a page that mounts no stylesheet of ours. */}
        <__Name__Styles />
        <p>{write.question}</p>
        {write.detail && <p className="__Name__-muted">{write.detail}</p>}
        {(write.form || expected) && (
          <div className="__Name__-form">
            {write.form}
            {expected && (
              <TypedField
                expected={expected}
                onType={(text) => {
                  typed = text;
                }}
              />
            )}
          </div>
        )}
      </div>
    ),
    ok: async () => {
      if (expected && typed.trim() !== expected) {
        Notifications.error(`Nothing was changed: "${expected}" was not typed.`);
        return;
      }

      // Not awaited: the dialog would stay open, its button spinning, for as long as the write runs.
      void write
        .ok()
        .catch((error: unknown) => Notifications.checkedError(error, "Could not finish"));
    },
  });
}

export function notifyDone(
  message: string,
  undo?: { label?: string; run: () => Promise<void> },
): void {
  if (!undo) {
    Notifications.ok(message);
    return;
  }

  Notifications.ok(
    <div className="__Name__ __Name__-dialog">
      {/* The dialog may open from a page that mounts no stylesheet of ours. */}
      <__Name__Styles />
      <span>{message} </span>
      <button
        type="button"
        className="__Name__-link"
        title="Reverse what was just done"
        onClick={() => {
          void undo.run().then(
            () => Notifications.ok("Undone."),
            (error: unknown) => Notifications.checkedError(error, "Could not undo"),
          );
        }}
      >
        {undo.label ?? "Undo"}
      </button>
    </div>,
    { timeout: 10_000 },
  );
}
