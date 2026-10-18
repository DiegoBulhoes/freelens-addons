import { useEffect, useState } from "react";

/** Moves every `intervalMs` while the window is shown, at once on return after a missed beat. */
export function useVisibleTick(intervalMs: number | undefined): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (intervalMs === undefined) return;

    let last = Date.now();
    const beat = () => {
      last = Date.now();
      setTick((current) => current + 1);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") beat();
    }, intervalMs);
    const onShow = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= intervalMs) beat();
    };

    document.addEventListener("visibilitychange", onShow);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [intervalMs]);

  return tick;
}
