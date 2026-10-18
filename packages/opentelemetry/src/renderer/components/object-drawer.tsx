import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Tone } from "./status";
import { OpenTelemetryStyles } from "./styles";

const {
  Component: { Drawer, Icon, MenuActions, MenuItem },
} = Renderer;

export interface DrawerAction {
  icon: string;
  title: string;
  onClick: () => void;
}

export interface ObjectDrawerProps {
  open: boolean;
  kind: string;
  name: string;
  onClose: () => void;
  actions?: DrawerAction[];
  state?: { tone: Tone; label: string; reason: string };
  /** `data-section`, for an e2e suite to find the body. */
  section?: string;
  children: ReactNode;
}

// The host's details drawer opens only from its own lists, so our pages open this one.
export function ObjectDrawer({
  open,
  kind,
  name,
  onClose,
  actions = [],
  state,
  section,
  children,
}: ObjectDrawerProps) {
  return (
    <Drawer
      className="OpenTelemetryObjectDrawer"
      open={open}
      title={`${kind}: ${name}`}
      onClose={onClose}
      // The host's own drawers put their actions in a toolbar MenuActions; its items carry the spacing.
      toolbar={
        actions.length > 0 && (
          <MenuActions toolbar autoCloseOnSelect>
            {actions.map((action) => (
              <MenuItem key={action.icon} onClick={action.onClick}>
                <Icon material={action.icon} tooltip={action.title} interactive />
                <span className="title">{action.title}</span>
              </MenuItem>
            ))}
          </MenuActions>
        )
      }
    >
      {open && (
        <div className="OpenTelemetry OpenTelemetry-drawer" data-section={section}>
          <OpenTelemetryStyles />
          {state &&
            (state.tone === "ok" || state.tone === "info" ? (
              <p className="OpenTelemetry-muted">{state.reason}</p>
            ) : (
              <div
                className={`OpenTelemetry-banner${state.tone === "critical" ? " OpenTelemetry-banner--critical" : ""}`}
              >
                <div className="OpenTelemetry-banner__title">{state.label}</div>
                <div className="OpenTelemetry-banner__body">{state.reason}</div>
              </div>
            ))}
          {children}
        </div>
      )}
    </Drawer>
  );
}
