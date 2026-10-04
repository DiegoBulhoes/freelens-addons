import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useState } from "react";

import { CertManagerStyles } from "./styles";

const {
  Component: { ConfirmDialog, Input, Notifications },
} = Renderer;

export interface ConfirmWrite {
  question: ReactNode;
  detail?: ReactNode;
  warning?: ReactNode;
  form?: ReactNode;
  label: string;
  destructive: boolean;
  typed?: () => string | undefined;
  ok: () => Promise<void>;
}

function TypedField({ expected, onType }: { expected: string; onType: (text: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="CertManager-form__field">
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

// The dialog copies plain-object props, so values reach `ok` through callbacks.
export function confirmWrite(write: ConfirmWrite): void {
  const expected = write.typed?.();
  let typed = "";

  ConfirmDialog.open({
    labelOk: write.label,
    okButtonProps: write.destructive ? { accent: true } : { primary: true },
    message: (
      <div className="CertManager CertManager-dialog">
        {/* The dialog may open from a page that mounts no stylesheet of ours. */}
        <CertManagerStyles />
        <p>{write.question}</p>
        {write.detail && <p className="CertManager-muted">{write.detail}</p>}
        {write.warning && <p className="CertManager-text--warning">{write.warning}</p>}
        {(write.form || expected) && (
          <div className="CertManager-form">
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
    <div className="CertManager CertManager-dialog">
      {/* The dialog may open from a page that mounts no stylesheet of ours. */}
      <CertManagerStyles />
      <span>{message} </span>
      <button
        type="button"
        className="CertManager-link"
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
