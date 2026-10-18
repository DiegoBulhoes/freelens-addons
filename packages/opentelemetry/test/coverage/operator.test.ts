import { describe, expect, it } from "vitest";

import {
  languageSetting,
  type OperatorList,
  operatorVersions,
  rememberedOperator,
  rememberOperator,
} from "../../src/renderer/api/coverage/operator";
import { keyOf } from "../../src/renderer/api/coverage/resolve";
import {
  operatorDeployments,
  operatorWith,
  variant,
  workloadNamed,
  workloads,
} from "../support/fixtures";

const exported = (): OperatorList => ({ items: operatorDeployments() });

describe("the operator's language switches", () => {
  it("finds the exported Deployment by its label and reads its defaults", () => {
    expect(operatorDeployments().map((item) => item.metadata.name)).toEqual([
      "opentelemetry-operator-controller-manager",
    ]);
    expect(languageSetting(exported(), "java")).toEqual({
      kind: "on",
      why: "--enable-java-instrumentation is on by default",
    });
    expect(languageSetting(exported(), "apache-httpd")).toEqual({
      kind: "on",
      why: "--enable-apache-httpd-instrumentation is on by default",
    });
    expect(languageSetting(exported(), "go")).toEqual({
      kind: "off",
      why: "--enable-go-instrumentation is off by default",
    });
    expect(languageSetting(exported(), "sdk")).toEqual({
      kind: "on",
      why: "no flag turns it off",
    });
  });

  it("reads the release manifest's env, and anything but a boolean as false", () => {
    const nginx = (value?: string) =>
      languageSetting(
        operatorWith((manager) => {
          manager.env = (manager.env ?? []).map((each) =>
            each.name === "ENABLE_NGINX_AUTO_INSTRUMENTATION" ? { name: each.name, value } : each,
          );
        }),
        "nginx",
      );

    expect(nginx("true")).toEqual({
      kind: "on",
      why: 'its ENABLE_NGINX_AUTO_INSTRUMENTATION is "true"',
    });
    expect(nginx("yes")).toEqual({
      kind: "off",
      why: 'its ENABLE_NGINX_AUTO_INSTRUMENTATION is "yes", which it reads as false',
    });
    expect(nginx(undefined).kind).toBe("off");
  });

  it("lets a flag beat the env, reads the last one, and stops at --", () => {
    const go = (tokens: string[], command?: string[]) =>
      languageSetting(
        operatorWith((manager) => {
          manager.command = command;
          manager.args = [...(manager.args ?? []), ...tokens];
          manager.env = [
            ...(manager.env ?? []),
            { name: "ENABLE_GO_AUTO_INSTRUMENTATION", value: "false" },
          ];
        }),
        "go",
      );

    expect(go(["--enable-go-instrumentation=false", "--enable-go-instrumentation"])).toEqual({
      kind: "on",
      why: "its args set --enable-go-instrumentation=true",
    });
    expect(go([], ["/manager", "--enable-go-instrumentation=1"]).kind).toBe("on");
    expect(go(["--", "--enable-go-instrumentation"])).toEqual({
      kind: "off",
      why: 'its ENABLE_GO_AUTO_INSTRUMENTATION is "false"',
    });
    expect(go(["--enable-go-instrumentation=maybe"])).toEqual({
      kind: "unknown",
      why: "its args set --enable-go-instrumentation=maybe, which is not a boolean",
    });
  });

  it("cannot tell what a valueFrom, an envFrom or a config file sets", () => {
    const java = (change: Parameters<typeof operatorWith>[0]) =>
      languageSetting(operatorWith(change), "java").why;

    expect(
      java((manager) => {
        manager.env = [
          { name: "ENABLE_JAVA_AUTO_INSTRUMENTATION", valueFrom: { configMapKeyRef: {} } },
        ];
      }),
    ).toBe("its ENABLE_JAVA_AUTO_INSTRUMENTATION comes from valueFrom");
    expect(
      java((manager) => {
        manager.envFrom = [{ configMapRef: { name: "operator" } }];
      }),
    ).toBe("its envFrom may set ENABLE_JAVA_AUTO_INSTRUMENTATION");
    expect(
      java((manager) => {
        manager.args = ["--config-file=/etc/opentelemetry-operator/config.yaml"];
      }),
    ).toBe("its --config-file may set --enable-java-instrumentation");
  });

  it("reads the first container when none is named manager, and nothing without one", () => {
    const renamed = operatorWith((manager) => {
      manager.name = "operator";
      manager.args = ["--enable-go-instrumentation"];
    });
    const [deployment] = operatorDeployments();

    const bare = operatorWith((manager) => {
      delete manager.args;
      delete manager.env;
    });

    expect(languageSetting(renamed, "go").kind).toBe("on");
    expect(languageSetting(bare, "nginx")).toEqual({
      kind: "off",
      why: "--enable-nginx-instrumentation is off by default",
    });
    expect(
      languageSetting(
        { items: [{ metadata: deployment?.metadata ?? {}, spec: { template: { spec: {} } } }] },
        "go",
      ),
    ).toEqual({ kind: "unknown", why: "its Deployment has no container" });
  });

  it("cannot tell when two operator Deployments disagree", () => {
    const on = operatorWith((manager) => {
      manager.args = ["--enable-go-instrumentation"];
    });
    const list: OperatorList = { items: [...operatorDeployments(), ...on.items] };

    expect(languageSetting(list, "go")).toEqual({
      kind: "unknown",
      why: "the 2 Deployments carrying app.kubernetes.io/name=opentelemetry-operator disagree on --enable-go-instrumentation",
    });
    expect(languageSetting(list, "java").kind).toBe("on");
  });

  it("is pending, not unknown, before the Deployment is read", () => {
    expect(languageSetting(undefined, "java")).toEqual({
      kind: "pending",
      why: "the operator's Deployment is not read yet",
    });
    expect(languageSetting(undefined, "sdk").kind).toBe("on");
  });

  it("remembers the last list read for the same versions, never a refusal", () => {
    const list = exported();

    rememberOperator("v1", list);
    rememberOperator("v1", { error: "403 Forbidden" });

    expect(rememberedOperator("v1")).toBe(list);
    expect(rememberedOperator("v2")).toBeUndefined();
  });

  it("keys a re-read on the operator's Deployments the scoped stores hold", () => {
    const operator = "opentelemetry-operator-system/opentelemetry-operator-controller-manager";
    const upgraded = variant(workloadNamed(operator), (data) => {
      data.metadata.resourceVersion = "1";
    });

    expect(operatorVersions(workloads())).toBe(
      `${operator}@${workloadNamed(operator).metadata.resourceVersion}`,
    );
    expect(operatorVersions([upgraded])).toBe(`${operator}@1`);
    expect(operatorVersions(workloads().filter((each) => keyOf(each) !== operator))).toBe("");
  });
});
