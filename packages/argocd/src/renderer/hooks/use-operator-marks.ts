import { useEffect, useMemo, useState } from "react";

import { onStateChange } from "../api/local-state";
import { listPins } from "../api/pins";

export interface OperatorMarks {
  pinnedIds: Set<string>;
  /** Call after the row menu writes a pin. */
  reload: () => void;
}

export function useOperatorMarks(): OperatorMarks {
  const [pins, setPins] = useState<string[]>(listPins);
  const pinnedIds = useMemo(() => new Set(pins), [pins]);

  // A pin's Undo writes after its menu has closed; only this listener sees it.
  useEffect(() => onStateChange(() => setPins(listPins())), []);

  return { pinnedIds, reload: () => setPins(listPins()) };
}
