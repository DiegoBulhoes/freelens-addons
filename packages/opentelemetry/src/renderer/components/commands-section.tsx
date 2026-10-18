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
    <section className="OpenTelemetry-section" data-section={section}>
      <h3 className="OpenTelemetry-section__title">Look further</h3>
      <div className="OpenTelemetry-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="OpenTelemetry-row">
            <span className="OpenTelemetry-row__main">
              <span className="OpenTelemetry-row__name">{label}</span>
              <code className="OpenTelemetry-row__reason">{command}</code>
            </span>
            <span className="OpenTelemetry-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="OpenTelemetry-button"
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
