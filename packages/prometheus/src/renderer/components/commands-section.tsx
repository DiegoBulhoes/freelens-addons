import { Renderer } from "@freelensapp/extensions";
import type { Command } from "../api/shared/commands";
import { type Fix, fixTitle, fixTooltip } from "../api/shared/fixes";
import type { DrawerAction } from "./object-drawer";

const {
  Component: { Icon, MenuItem, Notifications, WithTooltip },
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
    <section className="Prometheus-section" data-section={section}>
      <h3 className="Prometheus-section__title">Look further</h3>
      <div className="Prometheus-list">
        {commands.map(({ label, command }) => (
          <div key={label} className="Prometheus-row">
            <span className="Prometheus-row__main">
              <span className="Prometheus-row__name">{label}</span>
              <code className="Prometheus-row__reason">{command}</code>
            </span>
            <span className="Prometheus-row__actions">
              <WithTooltip tooltip="Copies the command, to paste into a terminal">
                <button
                  type="button"
                  className="Prometheus-button"
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

/** YAML to commit to Git; the extension never applies it. */
export function FixSection({ fixes, section }: { fixes: Fix[]; section: string }) {
  if (fixes.length === 0) return null;

  return (
    <section className="Prometheus-section" data-section={section}>
      <h3 className="Prometheus-section__title">Fix</h3>
      <p className="Prometheus-section__note">
        Copy it into the manifest in Git; nothing here changes the cluster.
      </p>
      <div className="Prometheus-list">
        {fixes.map((fix) => (
          <div key={fix.key} className="Prometheus-row">
            <span className="Prometheus-row__main">
              <span className="Prometheus-row__name">{fix.label}</span>
              <code className="Prometheus-row__reason Prometheus-yaml">{fix.yaml}</code>
            </span>
            <span className="Prometheus-row__actions">
              <WithTooltip tooltip="Copies the YAML to commit to Git; changes nothing in the cluster">
                <button
                  type="button"
                  className="Prometheus-button"
                  onClick={() => void copyText("Fix YAML", fix.yaml)}
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

export function FixMenuItems({ fixes }: { fixes: Fix[] }) {
  if (fixes.length === 0) {
    return (
      <MenuItem disabled>
        <Icon material="content_copy" tooltip="Nothing to change in its YAML" />
        <span className="title">Copy fix YAML</span>
      </MenuItem>
    );
  }

  return (
    <>
      {fixes.map((fix) => (
        <MenuItem key={fix.key} onClick={() => void copyText("Fix YAML", fix.yaml)}>
          <Icon material="content_copy" tooltip={fixTooltip(fix)} />
          <span className="title">{fixTitle(fix)}</span>
        </MenuItem>
      ))}
    </>
  );
}

export const fixActions = (fixes: Fix[]): DrawerAction[] =>
  fixes.map((fix) => ({
    key: fix.key,
    icon: "content_copy",
    title: fixTooltip(fix),
    onClick: () => void copyText("Fix YAML", fix.yaml),
  }));
