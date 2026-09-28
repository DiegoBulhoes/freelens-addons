import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";
import {
  argocdCommand,
  copyToClipboard,
  describeForHandover,
  kubectlCommand,
} from "../src/renderer/api/cli";
import { application, statusOf, variantOf } from "./fixtures";

describe("the same action, as a command", () => {
  const target = application("guestbook");

  it("qualifies the Application with its namespace", () => {
    expect(argocdCommand(target, "sync")).toBe(
      `argocd app sync ${target.getNs()}/${target.getName()}`,
    );
  });

  it("covers each action it offers", () => {
    expect(argocdCommand(target, "get")).toContain("argocd app get");
    expect(argocdCommand(target, "diff")).toContain("argocd app diff");
    expect(argocdCommand(target, "refresh")).toContain("--refresh");
    expect(argocdCommand(target, "hard-refresh")).toContain("--hard-refresh");
  });

  it("emits a kubectl patch that matches what the extension itself sends", () => {
    const patch = kubectlCommand(target, "sync");

    expect(patch).toContain(`kubectl -n ${target.getNs()} patch application ${target.getName()}`);
    expect(patch).toContain("--type merge");
    expect(patch).toContain('"operation":{"sync":{"prune":false}}');
  });

  it("emits the annotation patch for both refresh modes", () => {
    expect(kubectlCommand(target, "refresh")).toContain('"argocd.argoproj.io/refresh":"normal"');
    expect(kubectlCommand(target, "hard-refresh")).toContain('"argocd.argoproj.io/refresh":"hard"');
  });

  it("falls back to reading the object for actions kubectl cannot express", () => {
    expect(kubectlCommand(target, "diff")).toContain("get application");
    expect(kubectlCommand(target, "get")).toContain("-o yaml");
  });

  it("summarises an Application well enough to paste into an incident channel", () => {
    const summary = describeForHandover(target);

    expect(summary).toContain(target.getName());
    expect(summary).toContain(Application.getDestination(target));
    expect(summary).toContain(`sync:   ${Application.getSyncStatus(target)}`);
    expect(summary).toContain(`health: ${Application.getHealthStatus(target)}`);
    expect(summary).toContain("auto:   on");
  });
});

describe("commands for an Application in a bad state", () => {
  it("says the revision is unknown rather than printing undefined", () => {
    const fresh = variantOf("guestbook", (data) => {
      delete data.status;
    });

    expect(describeForHandover(fresh)).toContain("rev:    unknown");
  });

  it("says auto-sync is off when there is no automated policy", () => {
    const manual = variantOf("guestbook", (data) => {
      delete data.spec.syncPolicy;
    });

    expect(describeForHandover(manual)).toContain("auto:   off");
  });

  it("counts the drift into the summary when resources differ", () => {
    const drifting = variantOf("guestbook", (data) => {
      statusOf(data).sync = { status: "OutOfSync" };
      statusOf(data).resources = [
        { kind: "Deployment", name: "a", status: "OutOfSync" },
        { kind: "Service", name: "b", status: "Synced" },
      ];
    });

    expect(describeForHandover(drifting)).toContain("1 of 2 resources differ");
  });

  it("includes the health message when ArgoCD gives one", () => {
    const degraded = variantOf("guestbook", (data) => {
      statusOf(data).health = {
        status: "Degraded",
        message: "readiness probe failed",
      };
    });

    expect(describeForHandover(degraded)).toContain("readiness probe failed");
  });
});

describe("commands for objects that barely exist", () => {
  it("falls back to the argocd namespace when kubectl has none to use", () => {
    const orphan = variantOf("guestbook", (data) => {
      delete data.metadata.namespace;
    });

    expect(kubectlCommand(orphan, "sync")).toContain("kubectl -n argocd patch");
  });

  it("drops the qualifier from the argocd command when there is no namespace", () => {
    const orphan = variantOf("guestbook", (data) => {
      delete data.metadata.namespace;
    });

    expect(argocdCommand(orphan, "get")).toBe("argocd app get guestbook");
  });

  it("copies through the platform clipboard", async () => {
    const written: string[] = [];

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });

    await copyToClipboard("argocd app sync x");

    expect(written).toEqual(["argocd app sync x"]);
  });
});
