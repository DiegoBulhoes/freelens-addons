import { useMemo, useState } from "react";

import { listPins } from "../api/pins";

export interface OperatorMarks {
  pinnedIds: Set<string>;
  /** Pins are written straight to the state file; call this after the row menu writes one. */
  reload: () => void;
}

export function useOperatorMarks(): OperatorMarks {
  const [pins, setPins] = useState<string[]>(listPins);
  const pinnedIds = useMemo(() => new Set(pins), [pins]);

  return { pinnedIds, reload: () => setPins(listPins()) };
}
