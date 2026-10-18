import { Ingress, Pod } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";

import {
  controllerNamespaceOf,
  describeMissingPods,
  findArgoCDUrlIn,
  INSTANCE_LABEL,
  namespacesOf,
  type PodListing,
  pickComponentPod,
  pickRunningPod,
  selectApplicationPods,
} from "../../src/renderer/api/shared/workload-selection";
import {
  application,
  applications,
  pods,
  podVariantOf,
  statusOf,
  variantOf,
} from "../support/fixtures";

function pod(name: string, namespace: string, labels: Record<string, string> = {}): Pod {
  return new Pod({
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace,
      uid: `${namespace}/${name}`,
      resourceVersion: "1",
      selfLink: `/api/v1/namespaces/${namespace}/pods/${name}`,
      labels,
    },
    spec: { containers: [{ name: "app", image: "example" }] },
    status: { phase: "Running" },
  } as never);
}

function ingress(namespace: string, host: string, backend: Record<string, unknown>): Ingress {
  return new Ingress({
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: "argocd",
      namespace,
      uid: `${namespace}/argocd`,
      resourceVersion: "1",
      selfLink: `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/argocd`,
    },
    spec: { rules: [{ host, http: { paths: [{ path: "/", backend }] } }] },
  } as never);
}

describe("picking an Application's pods", () => {
  it("takes the pods ArgoCD labelled as belonging to it", () => {
    const target = application("guestbook");
    const name = target.getName();
    const namespace = namespacesOf(target)[0] as string;

    const mine = pod("guestbook-abc", namespace, { [INSTANCE_LABEL]: name });
    const theirs = pod("something-else", namespace, { [INSTANCE_LABEL]: "other-app" });

    expect(selectApplicationPods([mine, theirs], target)).toEqual([mine]);
  });

  it("falls back to the workload name when the instance label was renamed", () => {
    const target = variantOf("guestbook", (data) => {
      statusOf(data).resources = [
        { kind: "Deployment", name: "guestbook", namespace: "demo", status: "Synced" },
      ];
    });

    const byPrefix = pod("guestbook-7d9f-xyz", "demo");

    expect(selectApplicationPods([byPrefix], target)).toEqual([byPrefix]);
  });

  it("collects every namespace the Application touches, not only its destination", () => {
    const target = variantOf("guestbook", (data) => {
      statusOf(data).resources = [
        { kind: "Deployment", name: "a", namespace: "one", status: "Synced" },
        { kind: "Deployment", name: "b", namespace: "two", status: "Synced" },
      ];
    });

    expect(namespacesOf(target)).toEqual(expect.arrayContaining(["one", "two", "demo"]));
  });
});

describe("picking pods when nothing matches", () => {
  it("ignores a pod in another namespace even with the right label", () => {
    const target = application("guestbook");
    const elsewhere = pod("guestbook-abc", "somewhere-else", {
      [INSTANCE_LABEL]: target.getName(),
    });

    expect(selectApplicationPods([elsewhere], target)).toEqual([]);
  });

  it("returns nothing rather than everything for an Application with no namespaces", () => {
    const nowhere = variantOf("guestbook", (data) => {
      data.spec.destination = { server: "https://kubernetes.default.svc" };
      statusOf(data).resources = [];
    });

    expect(namespacesOf(nowhere)).toEqual([]);
    expect(selectApplicationPods([pod("anything", "default")], nowhere)).toEqual([]);
  });

  it("does not match a pod whose name merely starts with the same letters", () => {
    const target = variantOf("guestbook", (data) => {
      statusOf(data).resources = [
        { kind: "Deployment", name: "guest", namespace: "demo", status: "Synced" },
      ];
    });

    // The hyphen separates a workload's name from its pod suffix.
    expect(selectApplicationPods([pod("guestbook-x", "demo")], target)).toEqual([]);
  });
});

describe("finding the ArgoCD UI", () => {
  it("reads the host off an Ingress pointing at argocd-server", () => {
    const found = findArgoCDUrlIn(
      [
        ingress("argocd", "argo.example.test", {
          service: { name: "argocd-server", port: { number: 80 } },
        }),
      ],
      "argocd",
    );

    expect(found).toBe("https://argo.example.test");
  });

  it("reads the older backend spelling too", () => {
    const found = findArgoCDUrlIn(
      [ingress("argocd", "argo.example.test", { serviceName: "argocd-server", servicePort: 80 })],
      "argocd",
    );

    expect(found).toBe("https://argo.example.test");
  });

  it("offers nothing when the Ingress serves something else", () => {
    const found = findArgoCDUrlIn(
      [ingress("argocd", "grafana.example.test", { service: { name: "grafana" } })],
      "argocd",
    );

    expect(found).toBeUndefined();
  });

  it("ignores an Ingress in a different namespace", () => {
    const found = findArgoCDUrlIn(
      [ingress("other", "argo.example.test", { service: { name: "argocd-server" } })],
      "argocd",
    );

    expect(found).toBeUndefined();
  });

  it("offers nothing when there are no Ingresses at all", () => {
    expect(findArgoCDUrlIn([], "argocd")).toBeUndefined();
  });

  it("ignores a rule with no http section at all", () => {
    const pathless = new Ingress({
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "argocd",
        namespace: "argocd",
        uid: "argocd/argocd",
        resourceVersion: "1",
        selfLink: "/apis/networking.k8s.io/v1/namespaces/argocd/ingresses/argocd",
      },
      spec: { rules: [{ host: "argo.example.test" }] },
    } as never);

    expect(findArgoCDUrlIn([pathless], "argocd")).toBeUndefined();
  });

  it("ignores an Ingress with no spec to read", () => {
    const empty = new Ingress({
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "argocd",
        namespace: "argocd",
        uid: "argocd/empty",
        resourceVersion: "1",
        selfLink: "/apis/networking.k8s.io/v1/namespaces/argocd/ingresses/empty",
      },
    } as never);

    expect(findArgoCDUrlIn([empty], "argocd")).toBeUndefined();
  });

  it("ignores a backend that names no service in either spelling", () => {
    const anonymous = findArgoCDUrlIn(
      [ingress("argocd", "argo.example.test", { resource: { name: "static" } })],
      "argocd",
    );

    expect(anonymous).toBeUndefined();
  });

  it("offers nothing for a rule with a backend but no host", () => {
    const hostless = findArgoCDUrlIn(
      [ingress("argocd", "", { service: { name: "argocd-server" } })],
      "argocd",
    );

    expect(hostless).toBeUndefined();
  });
});

describe("finding the ArgoCD UI among Ingresses that make no sense", () => {
  it("takes the first match when two Ingresses both claim to serve it", () => {
    const first = ingress("argocd", "one.example.test", {
      service: { name: "argocd-server" },
    });
    const second = ingress("argocd", "two.example.test", {
      service: { name: "argocd-server" },
    });

    expect(findArgoCDUrlIn([first, second], "argocd")).toBe("https://one.example.test");
  });

  it("matches a service whose name merely contains argocd-server", () => {
    // Matched by substring so Helm-prefixed names like `my-release-argocd-server` resolve.
    const prefixed = ingress("argocd", "argo.example.test", {
      service: { name: "my-release-argocd-server" },
    });

    expect(findArgoCDUrlIn([prefixed], "argocd")).toBe("https://argo.example.test");
  });

  it("looks past a rule that serves something else to one that serves ArgoCD", () => {
    const grafana = ingress("argocd", "grafana.example.test", { service: { name: "grafana" } });
    const argo = ingress("argocd", "argo.example.test", { service: { name: "argocd-server" } });

    expect(findArgoCDUrlIn([grafana, argo], "argocd")).toBe("https://argo.example.test");
  });
});

describe("saying what a failed pod listing means", () => {
  const listing = (requestedNamespaces: string[], unreadableCount: number): PodListing => ({
    requestedNamespaces,
    unreadableCount,
  });

  const spreadOver = (namespaces: string[]) =>
    variantOf("guestbook", (data) => {
      statusOf(data).resources = namespaces.map((namespace) => ({
        kind: "Deployment",
        name: "guestbook-ui",
        namespace,
        status: "Synced",
      }));
    });

  const oneNamespace = namespacesOf(application("guestbook"));
  const twoNamespaces = namespacesOf(spreadOver(["demo", "monitoring"]));
  const manyNamespaces = namespacesOf(
    spreadOver(["demo", "monitoring", "logs", "edge", "ingress"]),
  );

  it("keeps today's sentence when every namespace answered", () => {
    expect(describeMissingPods("guestbook", listing(oneNamespace, 0))).toBe(
      "guestbook has no running pods to read logs from.",
    );
  });

  it("names the one namespace it could not read, and asserts no absence", () => {
    const text = describeMissingPods("guestbook", listing(oneNamespace, 1));

    expect(text).toBe(
      "Could not list pods in namespace demo. It is not known whether guestbook has any.",
    );
    expect(text).not.toContain("no running pods");
  });

  it("names both namespaces when both were refused", () => {
    expect(twoNamespaces).toHaveLength(2);

    expect(describeMissingPods("guestbook", listing(twoNamespaces, 2))).toBe(
      `Could not list pods in namespaces ${twoNamespaces.join(", ")}. ` +
        "It is not known whether guestbook has any.",
    );
  });

  it("names no namespace at all when only part of the request was refused", () => {
    const text = describeMissingPods("guestbook", listing(twoNamespaces, 1));

    expect(text).toContain("some of the 2 namespaces");
    // onLoadFailure never says which namespace refused.
    for (const namespace of twoNamespaces) expect(text).not.toContain(namespace);
  });

  it("counts rather than lists for an Application spanning many namespaces", () => {
    expect(manyNamespaces.length).toBeGreaterThan(3);

    const text = describeMissingPods("guestbook", listing(manyNamespaces, manyNamespaces.length));

    expect(text).toContain(`all ${manyNamespaces.length} namespaces`);
    expect(text).not.toContain(",");
  });

  it("falls back to the plain sentence when no namespace was attempted", () => {
    expect(describeMissingPods("guestbook", listing([], 0))).toBe(
      "guestbook has no running pods to read logs from.",
    );
  });
});

describe("finding the namespace ArgoCD runs in", () => {
  const elsewhere = (name: string, namespace: string, controller?: string) =>
    variantOf(name, (data) => {
      data.metadata.namespace = namespace;
      if (controller) statusOf(data).controllerNamespace = controller;
      else delete statusOf(data).controllerNamespace;
    });

  it("reads the namespace the controller reports", () => {
    expect(controllerNamespaceOf(applications())).toBe("argocd");
  });

  it("is not misled when the first Application lives outside the control plane", () => {
    const first = elsewhere("guestbook", "team-apps", "argocd");

    expect(controllerNamespaceOf([first, ...applications()])).toBe("argocd");
  });

  it("follows the controller most Applications report", () => {
    const other = [
      elsewhere("guestbook", "argocd-b", "argocd-b"),
      elsewhere("podinfo", "argocd-b", "argocd-b"),
    ];

    expect(controllerNamespaceOf([application("apps"), ...other])).toBe("argocd-b");
    expect(controllerNamespaceOf([...other, application("apps")])).toBe("argocd-b");
  });

  it("falls back to the first Application's namespace, then to argocd", () => {
    expect(controllerNamespaceOf([elsewhere("guestbook", "team-apps")])).toBe("team-apps");
    expect(controllerNamespaceOf([])).toBe("argocd");
  });
});

describe("picking pods from the cluster's own", () => {
  const named = (name: string) => pods().filter((pod) => pod.getName().startsWith(name));

  it("finds guestbook's pod by its Deployment, not helm-guestbook's or podinfo's copy", () => {
    const found = selectApplicationPods(pods(), application("guestbook")).map((pod) =>
      pod.getName(),
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^guestbook-ui-/);
    expect(named("guestbook-ui-").length).toBeGreaterThan(1);
  });

  it("opens each ArgoCD component's own pod in the namespace asked for", () => {
    const components = ["argocd-server", "argocd-repo-server", "argocd-application-controller"];

    for (const component of components) {
      const pod = pickComponentPod(pods(), component, "argocd");

      expect(pod?.getLabels(), component).toContain(`app.kubernetes.io/name=${component}`);
    }
    expect(pickComponentPod(pods(), "argocd-server", "demo")).toBeUndefined();
  });

  it("falls back to the pod name when an install relabelled its pods", () => {
    const [server] = named("argocd-server-");
    if (!server) throw new Error("no argocd-server pod in the fixtures");
    const relabelled = podVariantOf(server.getName(), (data) => {
      data.metadata.labels = {};
    });

    expect(pickComponentPod([relabelled], "argocd-server", "argocd")).toBe(relabelled);
    expect(pickComponentPod([relabelled], "argocd-repo-server", "argocd")).toBeUndefined();
  });

  it("prefers a running pod over one still starting, and takes any over none", () => {
    const [server] = named("argocd-server-");
    if (!server) throw new Error("no argocd-server pod in the fixtures");
    const starting = podVariantOf(server.getName(), (data) => {
      data.status.phase = "Pending";
    });

    expect(pickRunningPod([starting, server])).toBe(server);
    expect(pickRunningPod([starting])).toBe(starting);
    expect(pickRunningPod([])).toBeUndefined();
  });
});
