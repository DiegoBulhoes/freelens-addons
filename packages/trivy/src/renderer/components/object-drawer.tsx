import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Tone } from "./status";
import { TrivyStyles } from "./styles";

const {
  Component: { Drawer, Icon },
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
  children: ReactNode;
}

// Open it from a click that called preventDefault; close it before navigating from a link inside.
export function ObjectDrawer({
  open,
  kind,
  name,
  onClose,
  actions = [],
  state,
  children,
}: ObjectDrawerProps) {
  return (
    <Drawer
      className="TrivyObjectDrawer"
      open={open}
      title={`${kind}: ${name}`}
      onClose={onClose}
      toolbar={actions.map((action) => (
        <Icon
          key={action.icon}
          material={action.icon}
          tooltip={action.title}
          interactive
          onClick={action.onClick}
        />
      ))}
    >
      {open && (
        <div className="Trivy Trivy-drawer">
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
