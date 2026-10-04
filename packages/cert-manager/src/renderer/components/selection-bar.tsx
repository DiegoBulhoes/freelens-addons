import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";

import { CertManagerStyles } from "./styles";

const {
  Component: { WithTooltip },
} = Renderer;

export interface SelectionAction<Item> {
  label: string;
  tooltip: string;
  /** A destructive write: placed last, drawn as a caution. */
  caution?: boolean;
  run: (items: Item[]) => void;
}

export interface SelectionBarProps<Item> {
  getItems: () => Item[];
  pickOnlySelected: (items: Item[]) => Item[];
  hint: string;
  actions: SelectionAction<Item>[];
}

function SelectionBarView<Item>({
  getItems,
  pickOnlySelected,
  hint,
  actions,
}: SelectionBarProps<Item>) {
  const selected = pickOnlySelected(getItems());

  if (selected.length === 0) return null;

  return (
    <div className="CertManager CertManager-selection" data-section="selection">
      <CertManagerStyles />
      <div className="CertManager-selection__what">
        <span className="CertManager-selection__count">
          <b>{selected.length}</b> selected
        </span>
        <span className="CertManager-hint">{hint}</span>
      </div>
      <div className="CertManager-actions">
        {actions.map((action) => (
          <WithTooltip key={action.label} tooltip={action.tooltip}>
            <button
              type="button"
              className={`CertManager-button${action.caution ? " CertManager-button--caution" : ""}`}
              onClick={() => action.run(selected)}
            >
              {action.label}
            </button>
          </WithTooltip>
        ))}
      </div>
    </div>
  );
}

// `observer` drops the type parameter.
export const SelectionBar = observer(SelectionBarView) as <Item>(
  props: SelectionBarProps<Item>,
) => JSX.Element | null;
