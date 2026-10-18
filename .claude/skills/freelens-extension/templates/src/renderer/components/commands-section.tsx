import { Renderer } from "@freelensapp/extensions";

import type { Command } from "../api/shared/commands";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

export async function copyText(label: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
  }
}

export function CommandsSection({ commands, section }: { commands: Command[]; section: string }) {
  return (
    <section className="__Name__-section" data-section={section}>
      <h3 className="__Name__-section__title">Look further</h3>
      <div className="__Name__-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="__Name__-row">
            <span className="__Name__-row__main">
              <span className="__Name__-row__name">{label}</span>
              <code className="__Name__-row__reason">{command}</code>
            </span>
            <span className="__Name__-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="__Name__-button"
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
