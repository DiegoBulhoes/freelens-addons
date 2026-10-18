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
    <section className="MongoDB-section" data-section={section}>
      <h3 className="MongoDB-section__title">Look further</h3>
      <div className="MongoDB-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="MongoDB-row">
            <span className="MongoDB-row__main">
              <span className="MongoDB-row__name">{label}</span>
              <code className="MongoDB-row__reason">{command}</code>
            </span>
            <span className="MongoDB-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="MongoDB-button"
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
