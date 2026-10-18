import { Renderer } from "@freelensapp/extensions";

import type { Command } from "../api/shared/commands";

const {
  Component: { Notifications },
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
    <section className="CertManager-section" data-section={section}>
      <h2 className="CertManager-section__title">Look further</h2>
      <div className="CertManager-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="CertManager-row">
            <span className="CertManager-row__main">
              <span className="CertManager-row__name">{label}</span>
              <code className="CertManager-row__reason">{command}</code>
            </span>
            <span className="CertManager-row__actions">
              <button
                type="button"
                className="CertManager-button"
                title="Copies the command, to paste into a terminal; runs nothing"
                onClick={() => void copyText(label, command)}
              >
                Copy
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
