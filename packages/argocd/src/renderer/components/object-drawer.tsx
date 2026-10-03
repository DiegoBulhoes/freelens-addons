import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Tone } from "./status";
import { ArgoCDStyles } from "./styles";

const {
  Component: { Drawer, Icon },
} = Renderer;

export interface DrawerAction {
  /** A Material icon name. */
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
  /** `data-section`; the e2e suite finds the body by it. */
  section?: string;
  children: ReactNode;
}

/** Open it from a click that called preventDefault; close it before navigating from a link inside it. */
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
      className="ArgoCDObjectDrawer"
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
        <div className="ArgoCD ArgoCD-drawer" data-section={section}>
          <ArgoCDStyles />
          {state &&
            (state.tone === "ok" || state.tone === "info" ? (
              <p className="ArgoCD-muted">{state.reason}</p>
            ) : (
              <div
                className={`ArgoCD-banner${state.tone === "critical" ? " ArgoCD-banner--critical" : ""}`}
              >
                <div className="ArgoCD-banner__title">{state.label}</div>
                <div className="ArgoCD-banner__body">{state.reason}</div>
              </div>
            ))}
          {children}
        </div>
      )}
    </Drawer>
  );
}
