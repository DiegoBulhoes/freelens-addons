import { Renderer } from "@freelensapp/extensions";

import type { Command } from "../api/shared/commands";

const {
  Component: { DrawerTitle, Notifications, WithTooltip },
} = Renderer;

export async function copyText(label: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
  }
}

/** `hostDrawer`: inside the host's details drawer, headed as its other sections are. */
export function CommandsSection({
  commands,
  section,
  hostDrawer = false,
}: {
  commands: Command[];
  section: string;
  hostDrawer?: boolean;
}) {
  return (
    <section className="ArgoCD-section" data-section={section}>
      {hostDrawer ? (
        <DrawerTitle>Look further</DrawerTitle>
      ) : (
        <h3 className="ArgoCD-section__title">Look further</h3>
      )}
      <div className="ArgoCD-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="ArgoCD-row">
            <span className="ArgoCD-row__main">
              <span className="ArgoCD-row__name">{label}</span>
              <code className="ArgoCD-row__reason">{command}</code>
            </span>
            <span className="ArgoCD-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="ArgoCD-button"
                  onClick={() => void copyText(label, command)}
                >
                  Copy
                </button>
              </WithTooltip>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
