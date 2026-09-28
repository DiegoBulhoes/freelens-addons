import { Renderer } from "@freelensapp/extensions";

import { Application } from "../api/application";
import type { AttentionItem } from "../api/overview";
import { ApplicationMenuItem } from "../menus/application-menu";
import { since } from "./elapsed";

const MAX_DRIFTING_NAMED = 4;

const {
  Component: { Icon, MenuActions },
} = Renderer;

export function AttentionRow({
  item,
  parent,
  pinned,
  onChanged,
  onOpen,
}: {
  item: AttentionItem;
  parent?: Application;
  pinned: boolean;
  onChanged: () => void;
  onOpen: (application: Application) => void;
}) {
  const { application } = item;

  return (
    <div className={`ArgoCD-row ArgoCD-row--${item.severity}`}>
      <span className="ArgoCD-row__state">{item.headline}</span>

      <button type="button" className="ArgoCD-row__main" onClick={() => onOpen(application)}>
        <span className="ArgoCD-row__name">
          {pinned && <Icon small material="push_pin" className="ArgoCD-row__pin" />}
          <b>{application.getName()}</b>
          <span className="ArgoCD-row__meta">
            {Application.getProject(application)} · {Application.getDestination(application)}
            {item.wave !== undefined && ` · wave ${item.wave}`}
            {parent && ` · managed by ${parent.getName()}`}
          </span>
        </span>

        {item.detail && <span className="ArgoCD-row__reason">{item.detail}</span>}

        {item.drifting && item.drifting.length > 0 && (
          <span className="ArgoCD-row__reason ArgoCD-truncate">
            {item.drifting.slice(0, MAX_DRIFTING_NAMED).join(", ")}
            {item.drifting.length > MAX_DRIFTING_NAMED &&
              ` +${item.drifting.length - MAX_DRIFTING_NAMED} more`}
          </span>
        )}
      </button>

      <span className="ArgoCD-row__aside">{since(item.since)}</span>

      <span className="ArgoCD-row__actions">
        <MenuActions toolbar={false} autoCloseOnSelect>
          <ApplicationMenuItem object={application} onChanged={onChanged} />
        </MenuActions>
      </span>
    </div>
  );
}
