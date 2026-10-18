import { describe, expect, it } from "vitest";
import {
  INSTANCE_FILTER_TITLES,
  instanceRows,
  matchesInstanceFilter,
} from "../../src/renderer/api/instances/instances";
import {
  MONITOR_FILTER_TITLES,
  type MonitorFilter,
  matchesMonitorFilter,
  monitorRows,
} from "../../src/renderer/api/monitors/monitors";
import {
  attentionOf,
  cardsOf,
  describeHeadline,
  namedKey,
} from "../../src/renderer/api/overview/attention";
import {
  matchesRuleFilter,
  RULE_FILTER_TITLES,
  type RuleFilter,
  ruleRows,
} from "../../src/renderer/api/rules/rules";
import {
  agents,
  alertmanagers,
  monitorInventory,
  prometheuses,
  ruleInventory,
} from "../support/fixtures";

const monitors = () => monitorRows(monitorInventory());
const rules = () => ruleRows(ruleInventory());
const instances = () => instanceRows(prometheuses(), agents(), alertmanagers());

describe("the overview", () => {
  it("lists what needs attention, worst first", () => {
    const items = attentionOf(monitors(), rules(), instances());

    expect(items.map((item) => `${item.verdict.tone} ${item.page} ${item.name}`)).toEqual([
      "critical instances no-image",
      "critical monitors down-path",
      "critical monitors rejected",
      "critical monitors no-service",
      "critical monitors wrong-port",
      "critical rules broken-rule",
      "critical rules failing-rule",
      "warning monitors no-endpoints",
      "warning monitors orphan",
      "warning monitors excluded",
      "warning rules always-firing",
      "warning rules unselected-rule",
      "warning rules excluded-rule",
    ]);
    expect(items[0]?.meta).toBe("Prometheus · prom-broken");
  });

  it("opens each attention row's own drawer, not every row of that name", () => {
    const items = attentionOf(monitors(), rules(), instances());

    for (const item of items) expect(`${item.page}/${namedKey(item.opens)}`).toBe(item.key);
    expect(items.find((item) => item.name === "broken-rule")?.opens).toEqual({
      kind: "PrometheusRule",
      namespace: "prom-apps",
      name: "broken-rule",
    });
  });

  it("only narrows by name when the params name no single row", () => {
    expect(namedKey({ name: "scraper" })).toBeUndefined();
    expect(namedKey({ kind: "ServiceMonitor", name: "scraper" })).toBeUndefined();
    expect(namedKey({ kind: "ServiceMonitor", namespace: "prom-apps", name: "" })).toBeUndefined();
    expect(namedKey({ kind: "ServiceMonitor", namespace: "prom-apps", name: "orphan" })).toBe(
      "ServiceMonitor/prom-apps/orphan",
    );
  });

  it("each card counts what its list filter keeps", () => {
    const cards = cardsOf(monitors(), rules(), instances());

    expect(cards.map((card) => [card.label, card.value])).toEqual([
      ["Monitors down", 1],
      ["Monitors with no target", 3],
      ["Monitors not selected", 2],
      ["Monitors rejected or not loaded", 1],
      ["Rules rejected or failing", 2],
      ["Rules firing or pending", 2],
      ["Rules not loaded", 2],
      ["Instances needing attention", 1],
    ]);

    for (const card of cards) {
      const { opens } = card;

      expect(card.title).toMatch(/^Opens /);

      if (opens.page === "monitors") {
        expect(
          monitors().filter((row) => matchesMonitorFilter(row, opens.filter as MonitorFilter))
            .length,
        ).toBe(card.value);
      } else if (opens.page === "rules") {
        expect(
          rules().filter((row) => matchesRuleFilter(row, opens.filter as RuleFilter)).length,
        ).toBe(card.value);
      } else {
        expect(instances().filter((row) => matchesInstanceFilter(row, opens.filter)).length).toBe(
          card.value,
        );
      }
    }
  });

  it("puts the worst rules behind a card of their own", () => {
    const card = cardsOf(monitors(), rules(), instances()).find(
      (each) => each.label === "Rules rejected or failing",
    );
    const counted = rules()
      .filter((row) => matchesRuleFilter(row, "rejected"))
      .map((row) => `${row.verdict.label} ${row.name}`)
      .sort();

    expect(card).toEqual(
      expect.objectContaining({
        value: 2,
        tone: "critical",
        opens: { page: "rules", filter: "rejected" },
      }),
    );
    expect(counted).toEqual(["Evaluation failing failing-rule", "Rejected broken-rule"]);
  });

  it("each card's tooltip says what the list it opens shows, as that list's chip does", () => {
    const titles = Object.fromEntries(
      cardsOf(monitors(), rules(), instances()).map((card) => [card.label, card.title]),
    );

    expect(titles["Monitors down"]).toBe(MONITOR_FILTER_TITLES.down.replace("Shows ", "Opens "));
    expect(titles["Monitors down"]).toBe("Opens monitors with a target Prometheus cannot scrape");
    expect(titles["Rules rejected or failing"]).toBe(
      RULE_FILTER_TITLES.rejected.replace("Shows ", "Opens "),
    );
    expect(titles["Instances needing attention"]).toBe(
      INSTANCE_FILTER_TITLES.attention.replace("Shows ", "Opens "),
    );
    expect(new Set(Object.values(titles)).size).toBe(Object.keys(titles).length);
  });

  it("sums it up in one headline", () => {
    expect(describeHeadline(monitors(), rules(), instances())).toBe(
      "7 of 15 monitors, 5 of 7 rules, 1 of 4 instances need attention",
    );

    const healthy = monitors().filter((row) => row.state === "healthy");

    expect(describeHeadline(healthy, [], [])).toBe(
      "6 monitors and 0 rules, none needing attention",
    );
    expect(
      describeHeadline(
        monitors().filter((row) => row.name === "orphan"),
        [],
        [],
      ),
    ).toBe("1 of 1 monitor needs attention");
    expect(describeHeadline([], [], [])).toBe(
      "No monitor, rule or Prometheus in the namespaces shown",
    );
  });
});
