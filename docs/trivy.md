---
title: "Trivy extension"
description: "The idea behind the Trivy extension and its features"
---

# Trivy extension

Shows whether the Trivy operator scanned each workload, then what it found. In a list of reports a
workload with no report looks the same as a clean one; this extension tells them apart. It writes
nothing to the cluster.

## Contents

- [Pages](#pages)
- [Coverage](#coverage)
- [Scan progress](#scan-progress)
- [Features](#features)

## Pages

```mermaid
flowchart LR
  O["Overview<br/><i>coverage first</i>"]
  W["Workloads<br/><i>every one, judged or not</i>"]
  D["Workload drawer<br/><i>what to upgrade</i>"]
  V["Vulnerabilities<br/><i>the reports</i>"]
  VD["Report drawer<br/><i>the host's, with ours inside</i>"]
  R["RBAC<br/><i>what roles may do</i>"]
  C["Check drawer"]

  O -->|a card| W
  O -->|a workload| D
  W -->|a row| D
  V -->|a row| VD
  VD -->|its workload| D
  D -->|the workload, its Deployment, a pod| P["Host's lists<br/><i>Pods, Deployments, ReplicaSets</i>"]
  D -->|a CVE| AD["Its advisory<br/><i>https only</i>"]
  D -->|a check| A["Aqua's database<br/><i>what it is, how to fix it</i>"]
  R -->|a check| C
  C -->|its id| A
  C -->|a role| H["Host's Roles, ClusterRoles"]
```

Every page has the host's namespace selector. ClusterRoles stay listed whatever is selected.

## Coverage

```mermaid
flowchart TD
  K["Workload the operator<br/>knows about"] --> S{"Vulnerability report?"}
  S -->|yes| SC["Scanned<br/><i>the counts mean something</i>"]
  S -->|no| P{"ReplicaSet at zero<br/>replicas, or gone?"}
  P -->|yes| IN["Scaled away<br/><i>not scanned, not waiting</i>"]
  P -->|no| B{"SBOM?"}
  B -->|yes| RV["No verdict<br/><i>image read, never judged</i>"]
  B -->|no| NL["Not looked at<br/><i>the operator has not got to it</i>"]
```

| Rule | Detail |
|------|--------|
| A refused list is never an empty one | Refused everywhere, the page shows its alarm; refused in some namespaces, a banner names them and the counts leave them out |
| Reports are watched | Each kind as soon as its list lands; only failed kinds are listed again |
| SBOMs are polled | Read as metadata only and listed again every minute, sooner after a refusal |

## Scan progress

| State | When |
|-------|------|
| working | Workloads wait for a verdict and the judged count rose recently; the estimate comes from the rise over the last hour the page watched |
| stalled | Workloads wait and the count has not risen |
| stale | All judged, but some report is older than its `report-ttl` (24 hours by default) |
| complete | All judged and fresh; no banner shows |

The banner gives the age of the newest and oldest verdicts. Stalled and stale add read-only
commands: where the operator runs, its scan Jobs, its errors.

## Features

| Where | Features |
|-------|----------|
| Overview | Critical findings headline (a minimum while any workload lacks a verdict); scan progress; cards that open Workloads on a filter whose rows add up to the card; workloads waiting on a verdict; most exposed workloads |
| Workloads | Every workload with kind, namespace, coverage and counts added across its containers; a ReplicaSet's Deployment in its tooltip and search; filters All, No verdict, Findings, or a card's count |
| Workload drawer | State and what clears it; last scan; findings by severity and how many have a fix; upgrades that clear critical and high findings; pods; containers with an end-of-life base marked; failing config checks; exposed secrets, never the matched text; copy for a ticket when an upgrade clears a critical or high finding |
| Vulnerabilities | The host's list of reports by workload, container, namespace and image; its drawer adds the image, container, registry, base, counts and a link to the workload drawer |
| RBAC | One row per failing check with how many roles fail it; a check's drawer gives the fix and each role with what it grants. Roles or ClusterRoles whose reports cannot be listed are left out under a banner |
