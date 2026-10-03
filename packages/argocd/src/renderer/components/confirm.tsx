import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ArgoCDStyles } from "./styles";

const {
  Component: { ConfirmDialog, Input, Notifications },
} = Renderer;

export interface ConfirmWrite {
  question: ReactNode;
  detail?: ReactNode;
  /** Reports through callbacks, never a shared object. A function when it renders its own `TypedField`. */
  form?: ReactNode | ((onType: (text: string) => void) => ReactNode);
  label: string;
  destructive: boolean;
  /** Read on open and again on OK, so it can depend on what is ticked. */
  typed?: () => string | undefined;
  ok: () => Promise<void>;
}

/** Reports "" on unmount, so text typed before an option was unticked cannot confirm it later. */
export function TypedField({
  expected,
  onType,
}: {
  expected: string;
  onType: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const report = useRef(onType);

  report.current = onType;
  useEffect(() => () => report.current(""), []);

  return (
    <div className="ArgoCD-form__field">
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

/** Values reach `ok` through callbacks: the dialog copies plain-object props (test/dialog-state.test.ts). */
export function confirmWrite(write: ConfirmWrite): void {
  let typed = "";
  const onType = (text: string) => {
    typed = text;
  };
  const formOwnsField = typeof write.form === "function";
  const shown = formOwnsField ? undefined : write.typed?.();
  const form =
    typeof write.form === "function"
      ? (write.form as (onType: (text: string) => void) => ReactNode)(onType)
      : write.form;

  ConfirmDialog.open({
    labelOk: write.label,
    okButtonProps: write.destructive ? { accent: true } : { primary: true },
    message: (
      <div className="ArgoCD ArgoCD-dialog">
        {/* The host page may mount none of our styles. */}
        <ArgoCDStyles />
        <p>{write.question}</p>
        {write.detail && <p className="ArgoCD-muted">{write.detail}</p>}
        {(form || shown) && (
          <div className="ArgoCD-form">
            {form}
            {shown && <TypedField expected={shown} onType={onType} />}
          </div>
        )}
      </div>
    ),
    ok: async () => {
      const expected = write.typed?.();

      if (expected && typed.trim() !== expected) {
        Notifications.error(`Nothing was changed: "${expected}" was not typed.`);
        return;
      }

      await write.ok();
    },
  });
}

export function notifyDone(
  message: string,
  undo?: { label?: string; done: string; run: () => Promise<void>; failed: string },
): void {
  if (!undo) {
    Notifications.ok(message);
    return;
  }

  Notifications.ok(
    <div className="ArgoCD ArgoCD-dialog">
      {/* The host page may mount none of our styles. */}
      <ArgoCDStyles />
      <span>{message} </span>
      <button
        type="button"
        className="ArgoCD-link"
        title="Reverse what was just done"
        onClick={() => {
          void undo.run().then(
            () => Notifications.ok(undo.done),
            (error: unknown) => Notifications.checkedError(error, undo.failed),
          );
        }}
      >
        {undo.label ?? "Undo"}
      </button>
    </div>,
    { timeout: 10_000 },
  );
}
