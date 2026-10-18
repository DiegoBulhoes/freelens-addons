import { hostListOf } from "../api/shared/host-links";
import type { PodLike } from "../api/shared/types";
import { ago } from "../api/shared/verdict";
import { openHostList } from "../api/writes/actions";
import { DrawerLink } from "./drawer-link";

export function PodName({ pod, now, onLeave }: { pod: PodLike; now: number; onLeave: () => void }) {
  return (
    <span className="OpenTelemetry-row__name">
      <DrawerLink
        title="Opens the Pods list, narrowed to this pod"
        onClick={() => {
          onLeave();
          openHostList(hostListOf("Pod", pod.getName()));
        }}
      >
        {pod.getName()}
      </DrawerLink>
      <span className="OpenTelemetry-row__meta">
        {pod.status?.startTime ? `started ${ago(pod.status.startTime, now)}` : "not started"}
      </span>
    </span>
  );
}
