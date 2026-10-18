import { useEffect, useMemo, useState } from "react";
import { listPins } from "../api/overview/pins";
import { onStateChange } from "../api/shared/local-state";

export interface Pins {
  pinnedIds: Set<string>;
  /** Call after the row menu writes a pin. */
  reload: () => void;
}

export function usePins(): Pins {
  const [pins, setPins] = useState<string[]>(listPins);
  const pinnedIds = useMemo(() => new Set(pins), [pins]);

  // A pin's Undo writes after its menu has closed; only this listener sees it.
  useEffect(() => onStateChange(() => setPins(listPins())), []);

  return { pinnedIds, reload: () => setPins(listPins()) };
}
