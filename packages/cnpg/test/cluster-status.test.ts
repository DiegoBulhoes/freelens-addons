import { describe, expect, it } from "vitest";

import {
  budgetsOf,
  declaredIssues,
  maintenanceOf,
  maintenancePatch,
  managedRoles,
  placementOf,
  tablespaces,
} from "../src/renderer/api/cluster-status";
import { clusterNamed, pdbs, pods, variantOf } from "./fixtures";

describe("managed roles", () => {
  const roles = managedRoles(clusterNamed("orders-db"));

  it("lists the declared and the app's roles, but not the operator's own", () => {
    const names = roles.map((role) => role.name);

    expect(names).toEqual(expect.arrayContaining(["app", "auditor", "reporting"]));
    expect(names).not.toContain("streaming_replica");
    expect(names).not.toContain("postgres");
  });

  it("carries the error of a role it cannot reconcile", () => {
    expect(roles.find((role) => role.name === "auditor")).toMatchObject({
      tone: "critical",
      error: expect.stringContaining("role_that_does_not_exist"),
    });
    expect(roles.find((role) => role.name === "reporting")?.tone).toBe("ok");
  });

  it("warns of a role still pending without an error", () => {
    const pending = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.managedRolesStatus.cannotReconcile = undefined;
    });

    expect(managedRoles(pending).find((role) => role.name === "auditor")?.tone).toBe("warning");
    expect(managedRoles(clusterNamed("inventory-db"))).toEqual(
      managedRoles(clusterNamed("inventory-db")).filter((role) => role.state !== "reserved"),
    );
  });
});

describe("tablespaces", () => {
  it("lists each with its owner and state", () => {
    expect(tablespaces(clusterNamed("orders-db"))).toEqual([
      { name: "archive", owner: "app", state: "reconciled", tone: "ok", error: undefined },
    ]);
    expect(tablespaces(clusterNamed("billing-db"))).toEqual([]);
  });

  it("is critical with an error, and a warning while not reconciled", () => {
    const broken = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.status.tablespacesStatus = [
        { name: "a", state: "pending" },
        { name: "b", error: "no space" },
        { name: "c" },
      ];
    });

    expect(tablespaces(broken).map((each) => [each.name, each.tone, each.state])).toEqual([
      ["a", "warning", "pending"],
      ["b", "critical", "unknown"],
      ["c", "warning", "unknown"],
    ]);
  });
});

describe("what the attention list adds from roles and tablespaces", () => {
  it("names the role the operator could not create", () => {
    expect(declaredIssues(clusterNamed("orders-db"))).toEqual([
      expect.objectContaining({
        tone: "critical",
        label: "Role not applied",
        reason: expect.stringContaining("auditor"),
      }),
    ]);
    expect(declaredIssues(clusterNamed("billing-db"))).toEqual([]);
  });

  it("names a tablespace not applied", () => {
    const broken = variantOf(clusterNamed("billing-db"), (raw) => {
      raw.status.tablespacesStatus = [{ name: "archive", state: "pending" }];
    });

    expect(declaredIssues(broken)[0]).toMatchObject({
      label: "Tablespace not applied",
      reason: "archive: pending",
    });
  });
});

describe("the node maintenance window", () => {
  it("is closed and reuses volumes by default", () => {
    expect(maintenanceOf(clusterNamed("orders-db"))).toEqual({ inProgress: false, reusePVC: true });
  });

  it("reads and writes both settings", () => {
    const open = variantOf(clusterNamed("orders-db"), (raw) => {
      raw.spec.nodeMaintenanceWindow = { inProgress: true, reusePVC: false };
    });

    expect(maintenanceOf(open)).toEqual({ inProgress: true, reusePVC: false });
    expect(maintenancePatch({ inProgress: true, reusePVC: false })).toEqual({
      spec: { nodeMaintenanceWindow: { inProgress: true, reusePVC: false } },
    });
  });
});

describe("where each instance runs", () => {
  it("names its node and QoS class from its pod", () => {
    const placed = placementOf(pods(), "databases", "orders-db-1");

    expect(placed.node).toBe("freelens-addons-dev");
    expect(placed.qos).toBe("Burstable");
  });

  it("knows nothing of an instance without a pod", () => {
    expect(placementOf(pods(), "databases", "orders-db-9")).toEqual({
      node: undefined,
      qos: undefined,
    });
  });
});

describe("pod disruption budgets", () => {
  it("lists the cluster's, with what each allows", () => {
    const budgets = budgetsOf(clusterNamed("orders-db"), pdbs());

    expect(budgets.map((budget) => budget.name)).toEqual(["orders-db", "orders-db-primary"]);
    expect(budgets.every((budget) => budget.tone === "ok")).toBe(true);
    expect(
      budgetsOf(clusterNamed("orders-db"), pdbs()).find((each) => each.name === "orders-db-primary")
        ?.expected,
    ).toBe(1);
  });

  it("warns when fewer pods are healthy than the budget wants", () => {
    const [budget] = pdbs().filter(
      (each) => each.metadata.labels?.["cnpg.io/cluster"] === "orders-db",
    );
    if (!budget) throw new Error("no orders-db budget in the fixtures");

    const short = variantOf(budget, (raw) => {
      raw.status.currentHealthy = 0;
    });
    const unreported = variantOf(budget, (raw) => {
      raw.status = undefined;
    });

    expect(budgetsOf(clusterNamed("orders-db"), [short])[0]?.tone).toBe("warning");
    expect(budgetsOf(clusterNamed("orders-db"), [unreported])[0]).toMatchObject({
      expected: 0,
      allowed: 0,
      tone: "ok",
    });
  });
});
