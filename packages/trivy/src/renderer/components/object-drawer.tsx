import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Tone } from "./status";
import { TrivyStyles } from "./styles";

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

// For anything opened from our pages; the host's details drawer only opens from its own lists.
// Open it from a click that called preventDefault; close it before following a link in it.
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
      className="TrivyObjectDrawer"
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
        <div className="Trivy Trivy-drawer" data-section={section}>
          <TrivyStyles />
          {state &&
            (state.tone === "ok" || state.tone === "info" ? (
              <p className="Trivy-muted">{state.reason}</p>
            ) : (
              <div
                className={`Trivy-banner${state.tone === "critical" ? " Trivy-banner--critical" : ""}`}
              >
                <div className="Trivy-banner__title">{state.label}</div>
                <div className="Trivy-banner__body">{state.reason}</div>
              </div>
            ))}
          {children}
        </div>
      )}
    </Drawer>
  );
}
