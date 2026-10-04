import { describe, expect, it } from "vitest";

import { problemOf } from "../src/renderer/api/attention";
import { type ChainInputs, chainOf, explanationOf } from "../src/renderer/api/chain";
import { commandsFor, issuerCommands } from "../src/renderer/api/commands";
import {
  certificateNamed,
  certificateRequests,
  challenges,
  fixtureNow,
  issuerIndex,
  orders,
} from "./fixtures";

const now = fixtureNow();
const inputs: ChainInputs = {
  index: issuerIndex(),
  requests: certificateRequests(),
  orders: orders(),
  challenges: challenges(),
};

const commandsOf = (name: string) => {
  const certificate = certificateNamed(name);

  return commandsFor(
    certificate,
    problemOf(certificate, now),
    explanationOf(chainOf(certificate, inputs)),
  ).map((each) => each.command);
};

describe("the commands for a certificate", () => {
  it("offers only its status when nothing is wrong", () => {
    expect(commandsOf("web-tls")).toEqual(["cmctl status certificate web-tls -n demo"]);
  });

  it("points at the broken issuer before offering to renew", () => {
    expect(commandsOf("renewal-stalls")).toEqual([
      "cmctl status certificate renewal-stalls -n demo",
      "kubectl describe issuer flaky-ca -n demo",
      "cmctl renew renewal-stalls -n demo",
    ]);
  });

  it("points at the challenge for a stuck ACME certificate, and does not offer a renew", () => {
    const commands = commandsOf("acme-web");

    expect(commands[1]).toMatch(/^kubectl describe challenge acme-web-1-\d+-\d+ -n demo$/);
    expect(commands.some((each) => each.includes("renew"))).toBe(false);
  });

  it("describes nothing for an issuer that does not exist, since there is nothing to describe", () => {
    expect(commandsOf("orphan")).toEqual(["cmctl status certificate orphan -n demo"]);
  });

  it("drops the namespace flag for a cluster-scoped issuer", () => {
    const commands = commandsFor(certificateNamed("web-tls"), "renewal-overdue", {
      kind: "ClusterIssuer",
      name: "demo-ca",
      state: "failed",
    }).map((each) => each.command);

    expect(commands).toContain("kubectl describe clusterissuer demo-ca");
  });

  it("does not describe the certificate itself, which the status command already does", () => {
    const commands = commandsFor(certificateNamed("orphan"), "not-ready", {
      kind: "Certificate",
      name: "orphan",
      namespace: "demo",
      state: "failed",
    });

    expect(commands).toHaveLength(1);
  });
});

describe("an issuer's commands", () => {
  it("describes a namespaced Issuer in its namespace", () => {
    expect(issuerCommands("Issuer", "broken-ca", "demo").map((each) => each.command)).toEqual([
      "kubectl describe issuer broken-ca -n demo",
    ]);
  });

  it("describes a ClusterIssuer without a namespace", () => {
    expect(issuerCommands("ClusterIssuer", "demo-ca").map((each) => each.command)).toEqual([
      "kubectl describe clusterissuer demo-ca",
    ]);
  });
});
