import { Renderer } from "@freelensapp/extensions";

import type { Command } from "../api/shared/commands";

const {
  Component: { Notifications, WithTooltip },
} = Renderer;

async function copyCommand({ label, command }: Command): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    Notifications.ok(`${label} copied.`);
  } catch (error) {
    Notifications.checkedError(error, `Could not copy ${label.toLowerCase()}`);
  }
}

export function CommandsSection({ commands, section }: { commands: Command[]; section: string }) {
  if (commands.length === 0) return null;

  return (
    <section className="Trivy-section" data-section={section}>
      <h3 className="Trivy-section__title">Look further</h3>
      <div className="Trivy-list">
        {commands.map((each) => (
          <div key={each.label} className="Trivy-row">
            <span className="Trivy-row__main">
              <span className="Trivy-row__name">{each.label}</span>
              <code className="Trivy-row__reason">{each.command}</code>
            </span>
            <span className="Trivy-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="Trivy-button"
                  onClick={() => void copyCommand(each)}
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
