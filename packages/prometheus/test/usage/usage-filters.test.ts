import { describe, expect, it } from "vitest";

import { podRows, type UsageMetrics } from "../../src/renderer/api/usage/usage";
import {
  chosenPods,
  describeChoice,
  filterPods,
  keepChosen,
  nodeChoices,
  podChartTitle,
  podsOnNodes,
  stillOffered,
} from "../../src/renderer/api/usage/usage-filters";
import { pods, pvcs, usageMetrics, variant } from "../support/fixtures";

const NODE = "freelens-addons-dev";
const SEED = "monitoring/prometheus-seed-0";
const OPERATOR = "prometheus-operator/prometheus-operator-65bdfd9bf9-wlbsw";

// One pod moved to a second node, as the dev cluster has only one.
const rows = () =>
  podRows(
    pods().map((pod) =>
      `${pod.getNs()}/${pod.getName()}` === OPERATOR
        ? variant(pod, (data) => {
            data.spec = { ...data.spec, nodeName: "worker-1" };
          })
        : pod,
    ),
    usageMetrics() as UsageMetrics,
    pvcs(),
  );

describe("the node and pod filters", () => {
  it("offer each node once, sorted, without pods not yet placed", () => {
    expect(nodeChoices([NODE, undefined, "worker-1", NODE, ""])).toEqual([NODE, "worker-1"]);
    expect(nodeChoices(rows().map((row) => row.node))).toEqual([NODE, "worker-1"]);
  });

  it("keep every name with nothing chosen, and only the chosen otherwise", () => {
    expect(keepChosen([])("anything")).toBe(true);
    expect(keepChosen([NODE])(NODE)).toBe(true);
    expect(keepChosen([NODE])("worker-1")).toBe(false);
  });

  it("narrow the pods to those on the chosen nodes", () => {
    const all = rows();

    expect(podsOnNodes(all, [])).toHaveLength(all.length);
    expect(podsOnNodes(all, ["worker-1"]).map((row) => row.key)).toEqual([OPERATOR]);
    expect(podsOnNodes(all, [NODE]).some((row) => row.key === OPERATOR)).toBe(false);
    expect(podsOnNodes(all, [NODE]).some((row) => row.key === SEED)).toBe(true);
  });

  it("drop a chosen pod or node that is no longer offered", () => {
    const onDev = podsOnNodes(rows(), [NODE]);

    expect(chosenPods(onDev, [SEED, OPERATOR, "gone/pod-0"])).toEqual([SEED]);
    expect(stillOffered([NODE], [NODE, "gone"])).toEqual([NODE]);
  });

  it("show only the chosen pods, or every pod on the nodes when none is", () => {
    const all = rows();

    expect(filterPods(all, [], [SEED]).map((row) => row.key)).toEqual([SEED]);
    expect(filterPods(all, ["worker-1"], [SEED]).map((row) => row.key)).toEqual([OPERATOR]);
    expect(filterPods(all, [NODE], [])).toEqual(podsOnNodes(all, [NODE]));
  });

  it("name the chart after the top ten, or after what was chosen", () => {
    expect(podChartTitle("CPU", 0, 10)).toBe("Top 10 by CPU");
    expect(podChartTitle("CPU", 2, 10)).toBe("2 chosen by CPU");
    expect(podChartTitle("Memory", 12, 10)).toBe("Top 10 of 12 chosen by Memory");
  });

  it("say what is chosen, as the host's namespace filter does", () => {
    const names = { all: "All nodes", one: "Node", many: "Nodes" };

    expect(describeChoice([], names)).toBe("All nodes");
    expect(describeChoice([NODE], names)).toBe(`Node: ${NODE}`);
    expect(describeChoice(["a", "b"], names)).toBe("Nodes: a, b");
    expect(describeChoice(["a", "b", "c", "d"], names)).toBe("Nodes: a, b +2");
  });
});
