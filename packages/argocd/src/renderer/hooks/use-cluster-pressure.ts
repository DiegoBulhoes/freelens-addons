import { useEffect } from "react";

import { type ClusterPressure, getClusterPressure, loadNodes } from "../api/cluster-health";

export function useClusterPressure(): ClusterPressure[] {
  useEffect(() => {
    void loadNodes();
  }, []);

  return getClusterPressure();
}
