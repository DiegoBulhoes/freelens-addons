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
  O["Overview<br/><i>coverage first</i>"] --> W["Workloads<br/><i>every one, judged or not</i>"]
  W --> D["Workload drawer<br/><i>what to upgrade</i>"]
  V["Vulnerabilities<br/><i>the reports</i>"] --> D
  R["RBAC<br/><i>what roles may do</i>"] --> C["Check drawer"]
  D --> A["Advisory and check pages<br/><i>external</i>"]
  C --> A
```

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

A refused list is never shown as an empty one: a banner names the namespaces, and the counts leave
them out.

## Scan progress

| State | When |
|-------|------|
| working | Workloads wait for a verdict and the judged count rose recently |
| stalled | Workloads wait and the count has not risen |
| stale | All judged, but a report is older than its `report-ttl` (24 hours by default) |
| complete | All judged and fresh; no banner shows |

## Features

| Page | Shows |
|------|-------|
| Overview | Critical findings, scan progress, workloads waiting on a verdict and the most exposed ones |
| Workloads | Every workload with its coverage and counts. The drawer gives the upgrades that clear critical and high findings, failing checks and exposed secrets, never the matched text |
| Vulnerabilities | The host's list of reports; its drawer links the workload |
| RBAC | One row per failing check, with the fix and each role that fails it |
