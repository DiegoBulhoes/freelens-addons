import { Renderer } from "@freelensapp/extensions";

import type { Command } from "../api/commands";

const {
  Component: { Icon, Notifications },
} = Renderer;

// Electron grants the renderer clipboard access, so a resolved promise is the whole check.
export function CommandList({ commands }: { commands: Command[] }) {
  const copy = async (command: Command) => {
    try {
      await navigator.clipboard.writeText(command.command);
      Notifications.ok(`Copied: ${command.command}`);
    } catch (error) {
      Notifications.error(`Could not copy to the clipboard: ${String(error)}`);
    }
  };

  return (
    <div className="CertManager-commands">
      {commands.map((command) => (
        <div key={command.command} className="CertManager-command">
          <span className="CertManager-command__label">{command.label}</span>
          <code className="CertManager-command__text">{command.command}</code>
          <button
            type="button"
            className="CertManager-icon-button"
            aria-label={`Copy ${command.command}`}
            title="Copies the command to the clipboard; runs nothing"
            onClick={() => void copy(command)}
          >
            <Icon small material="content_copy" />
          </button>
        </div>
      ))}
    </div>
  );
}
