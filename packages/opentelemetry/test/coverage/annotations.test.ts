import { describe, expect, it } from "vitest";

import {
  annotationValue,
  COMMON_CONTAINER_NAMES,
  containerBlockers,
  containersFor,
  LANGUAGES,
  optInsOf,
  PREFIX,
} from "../../src/renderer/api/coverage/annotations";
import { namespaceNamed, variant, workloadNamed } from "../support/fixtures";

const PYTHON = `${PREFIX}inject-python`;

describe("which value the operator acts on", () => {
  it("takes the pod template's false over the Namespace's true, and the Namespace's when the template has none", () => {
    const [optedOut] = optInsOf(
      workloadNamed("otel-namespace/opted-out"),
      namespaceNamed("otel-namespace"),
    );
    const [inherited] = optInsOf(
      workloadNamed("otel-namespace/inherited"),
      namespaceNamed("otel-namespace"),
    );

    expect(optedOut).toMatchObject({ template: "false", namespace: "true", value: "false" });
    expect(optedOut?.from).toBe("pod template");
    expect(inherited).toMatchObject({ namespace: "true", value: "true", from: "Namespace" });
  });

  it("follows annotation.go's five rules in order, ignoring case", () => {
    expect(annotationValue(undefined, "true")).toEqual({ value: "true", from: "pod template" });
    expect(annotationValue(undefined, undefined)).toEqual({ value: "", from: undefined });
    expect(annotationValue("true", undefined)).toEqual({ value: "true", from: "Namespace" });
    expect(annotationValue("TRUE", "python")).toEqual({ value: "python", from: "pod template" });
    expect(annotationValue("False", "TRUE")).toEqual({ value: "true", from: "pod template" });
    expect(annotationValue("otel-late/python", "True")).toEqual({
      value: "otel-late/python",
      from: "Namespace",
    });
  });
});

describe("opt-ins", () => {
  it("reads the template, the Namespace and the workload's own metadata", () => {
    expect(optInsOf(workloadNamed("otel-apps/checkout"))).toEqual([
      {
        language: "python",
        key: PYTHON,
        template: "true",
        namespace: undefined,
        workload: undefined,
        value: "true",
        from: "pod template",
      },
    ]);
    expect(
      optInsOf(workloadNamed("otel-namespace/node-agent"), namespaceNamed("otel-namespace")),
    ).toMatchObject([{ language: "python", namespace: "true", value: "true", from: "Namespace" }]);
    expect(optInsOf(workloadNamed("otel-apps/misplaced"), namespaceNamed("otel-apps"))).toEqual([
      {
        language: "python",
        key: PYTHON,
        template: undefined,
        namespace: undefined,
        workload: "true",
        value: "",
        from: undefined,
        misplaced: "true",
      },
    ]);
  });

  it("calls a workload's key misplaced only where it would take effect on the template", () => {
    const misplaced = workloadNamed("otel-apps/misplaced");
    const namespaceSaying = (value: string) =>
      variant(namespaceNamed("otel-apps"), (data) => {
        data.metadata.annotations = { [PYTHON]: value };
      });
    const own = (value: string) =>
      variant(misplaced, (data) => {
        data.metadata.annotations = { ...data.metadata.annotations, [PYTHON]: value };
      });

    expect(optInsOf(misplaced, namespaceSaying("false"))).toMatchObject([
      { value: "false", from: "Namespace", misplaced: "true" },
    ]);
    expect(optInsOf(own("otel-late/python"), namespaceSaying("false"))[0]?.misplaced).toBe(
      "otel-late/python",
    );
    expect(optInsOf(misplaced, namespaceSaying("true"))[0]?.misplaced).toBeUndefined();
    expect(optInsOf(own("false"))).toEqual([]);
  });

  it("finds none on a collector's Deployment or an unrelated one", () => {
    expect(
      optInsOf(
        workloadNamed("otel-collectors/gateway-collector"),
        namespaceNamed("otel-collectors"),
      ),
    ).toEqual([]);
    expect(optInsOf(workloadNamed("demo/web"), namespaceNamed("demo"))).toEqual([]);
  });

  it("knows every language's keys, nginx's odd list key included", () => {
    expect(Object.keys(LANGUAGES)).toHaveLength(8);
    expect(LANGUAGES.nginx.containerNames).toBe(`${PREFIX}inject-nginx-container-names`);
    expect(LANGUAGES["apache-httpd"].inject).toBe(`${PREFIX}inject-apache-httpd`);
  });
});

describe("which containers get the agent", () => {
  const checkout = workloadNamed("otel-apps/checkout");
  const annotated = (annotations: Record<string, string>) =>
    variant(checkout, (data) => {
      Object.assign(data.spec.template.metadata?.annotations ?? {}, annotations);
    });

  it("takes the first container when nothing names one", () => {
    expect(containersFor(checkout, "python")).toEqual({
      names: ["app"],
      source: "first container",
    });
    expect(
      containersFor(
        variant(checkout, (data) => {
          data.spec.template.spec = { containers: [] };
        }),
        "python",
      ),
    ).toEqual({ names: [], source: "first container" });
  });

  it("takes the common list, then the language's own, from the template or the Namespace", () => {
    expect(
      containersFor(annotated({ [LANGUAGES.python.containerNames]: "app" }), "python"),
    ).toEqual({ names: ["app"], source: "annotation" });
    expect(
      containersFor(
        annotated({ [COMMON_CONTAINER_NAMES]: "app,web", [LANGUAGES.python.containerNames]: "x" }),
        "python",
      ).names,
    ).toEqual(["app", "web", "x"]);

    const namespace = variant(namespaceNamed("otel-late"), (data) => {
      data.metadata.annotations = { [COMMON_CONTAINER_NAMES]: "app" };
    });

    expect(containersFor(workloadNamed("otel-late/late"), "python", namespace)).toEqual({
      names: ["app"],
      source: "annotation",
    });
  });

  it("finds nothing that stops a single language", () => {
    expect(containerBlockers(checkout, ["python"])).toEqual([]);
  });

  it("refuses a list that is not comma-separated names, as isValidContainersAnnotation does", () => {
    expect(
      containerBlockers(annotated({ [COMMON_CONTAINER_NAMES]: "app, web" }), ["python"]),
    ).toEqual([
      `${COMMON_CONTAINER_NAMES} is "app, web", not a comma-separated list of container names`,
    ]);
  });

  it("needs container names for each language once there are several", () => {
    const both = annotated({ [`${PREFIX}inject-java`]: "true" });

    expect(containerBlockers(both, ["java", "python"])).toEqual([
      "Java and Python are injected together, so each must name its containers",
    ]);
    expect(
      containerBlockers(
        annotated({
          [LANGUAGES.java.containerNames]: "app",
          [LANGUAGES.python.containerNames]: "app",
        }),
        ["java", "python"],
      ),
    ).toEqual([]);
  });

  it("refuses a container named twice for one language", () => {
    expect(
      containerBlockers(
        annotated({ [COMMON_CONTAINER_NAMES]: "app", [LANGUAGES.python.containerNames]: "app" }),
        ["python"],
      ),
    ).toEqual(["Python names container app twice"]);
  });
});
