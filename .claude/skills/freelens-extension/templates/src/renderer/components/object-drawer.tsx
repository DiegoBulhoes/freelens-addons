import { Renderer } from "@freelensapp/extensions";
import type { ReactNode } from "react";

import type { Tone } from "./status";
import { __Name__Styles } from "./styles";

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

// For what the host cannot list; a Kubernetes object uses the host's details drawer.
// Open it from a click that called preventDefault; close it before following a link in it.
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
      className="__Name__ObjectDrawer"
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
        <div className="__Name__ __Name__-drawer">
          <__Name__Styles />
          {state &&
            (state.tone === "ok" || state.tone === "info" ? (
              <p className="__Name__-muted">{state.reason}</p>
            ) : (
              <div
                className={`__Name__-banner${state.tone === "critical" ? " __Name__-banner--critical" : ""}`}
              >
                <div className="__Name__-banner__title">{state.label}</div>
                <div className="__Name__-banner__body">{state.reason}</div>
              </div>
            ))}
          {children}
        </div>
      )}
    </Drawer>
  );
}
