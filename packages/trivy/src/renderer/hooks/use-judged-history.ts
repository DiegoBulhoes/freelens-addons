import { useEffect, useRef, useState } from "react";

import { type JudgedSample, recordJudged } from "../api/overview/scan-progress";

const TICK_MS = 60_000;

// The tick re-renders a quiet page, so a scan that stops is called stalled without a store change.
export function useJudgedHistory(judged: number | undefined, scope: string): JudgedSample[] {
  const kept = useRef<{ scope: string; history: JudgedSample[] }>({ scope, history: [] });
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), TICK_MS);

    return () => clearInterval(timer);
  }, []);

  if (kept.current.scope !== scope) kept.current = { scope, history: [] };

  if (judged !== undefined) {
    kept.current.history = recordJudged(kept.current.history, judged, Date.now());
  }

  return kept.current.history;
}
