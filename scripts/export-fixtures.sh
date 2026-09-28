#!/usr/bin/env bash
#
# Refresh the test fixtures from a live cluster.
#
# The tests run against real cluster objects rather than ones written to agree
# with the code. Hand-written fixtures only ever contain the fields the author
# remembered, which is exactly why they miss things — `spec.sources` versus
# `spec.source`, an Application with no status yet, a history entry with
# `revisions` instead of `revision`. Every one of those has been a real bug
# here.
#
# Not part of the build. Run it when the shape of what ArgoCD reports changes,
# then read the diff before committing.
#
# Usage: KUBECONFIG=/path/to/kubeconfig scripts/export-fixtures.sh [package...]
#        with no argument, every package is refreshed.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Domains to redact come from .env, which is git-ignored, so no private
# hostname is ever written into a file that gets committed.
# shellcheck source=/dev/null
[[ -f .env ]] && source .env
export FIXTURE_REDACT_DOMAINS="${FIXTURE_REDACT_DOMAINS:-}"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

out=""

emit() {
  local kind="$1" file="$2"
  shift 2

  echo "  ${kind} → ${out}/${file}"
  kubectl get "${kind}" "$@" -o json | python3 scripts/sanitise-fixture.py > "${out}/${file}"
}

argocd() {
  emit applications.argoproj.io applications.json -A
  emit appprojects.argoproj.io app-projects.json -A
  emit nodes nodes.json
  emit events events.json -A --field-selector type=Warning
}

# Four report kinds, because the question the extension answers is not "what
# did Trivy find" but "what did it fail to look at". That needs the SBOMs (the
# image was read), the vulnerability reports (a verdict was reached) and the
# config audits, whose workload-kinded subjects are the closest thing the
# operator has to a list of what it knows about.
trivy() {
  emit vulnerabilityreports.aquasecurity.github.io vulnerability-reports.json -A
  emit sbomreports.aquasecurity.github.io sbom-reports.json -A
  emit configauditreports.aquasecurity.github.io config-audit-reports.json -A
  emit exposedsecretreports.aquasecurity.github.io exposed-secret-reports.json -A
  # The workloads themselves: a report names a ReplicaSet, and the pods it
  # actually runs are only knowable from the cluster. Env values are redacted
  # by the sanitiser — see its Pod branch.
  emit pods pods.json -A
  # RBAC is assessed per role, and the cluster-scoped ones carry an empty
  # namespace label — which is what the subject parser has to tolerate.
  emit rbacassessmentreports.aquasecurity.github.io rbac-reports.json -A
  emit clusterrbacassessmentreports.aquasecurity.github.io cluster-rbac-reports.json
}

# The chain a failing certificate is explained by runs Certificate →
# CertificateRequest → Order → Challenge, plus the issuer it names. TLS Secrets
# come for their type and annotations only — the sanitiser removes their data —
# because which of them a Certificate manages is read from those and nothing
# else. Ingresses, because a TLS Secret an Ingress serves and nothing manages is
# the gap the extension's coverage page is for.
cert-manager() {
  emit certificates.cert-manager.io certificates.json -A
  emit certificaterequests.cert-manager.io certificate-requests.json -A
  emit issuers.cert-manager.io issuers.json -A
  emit clusterissuers.cert-manager.io cluster-issuers.json
  emit orders.acme.cert-manager.io orders.json -A
  emit challenges.acme.cert-manager.io challenges.json -A
  emit ingresses.networking.k8s.io ingresses.json -A
  emit secrets tls-secrets.json -A --field-selector type=kubernetes.io/tls

  # The moment of export, because nothing in these objects records it. The other
  # packages anchor "now" to the newest timestamp in their fixtures, which the
  # cluster keeps refreshing; cert-manager writes renewalTime and notAfter once,
  # so its newest timestamp can be the very instant a renewal fell due — and a
  # renewal due at "now" is never late.
  printf '{ "exportedAt": "%s" }\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${out}/exported-at.json"
  echo "  exported at → ${out}/exported-at.json"
}

packages=("$@")
[[ ${#packages[@]} -eq 0 ]] && packages=(argocd trivy cert-manager)

# Only the development cluster. The repository is public, and a real cluster's
# fixtures are its inventory, its roles and its open CVEs, workload by workload.
# The dev k3s is started with a fixed node name, which is what is checked.
if [[ "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')" != "freelens-addons-dev" ]]; then
  echo "refusing: this is not the development cluster (its only node is freelens-addons-dev)." >&2
  echo "Fixtures are committed to a public repository; export them from 'make cluster' only." >&2
  exit 1
fi

echo "Exporting fixtures from $(kubectl config current-context)"

for package in "${packages[@]}"; do
  out="packages/${package}/test/fixtures"

  [[ -d "packages/${package}" ]] || { echo "no such package: ${package}" >&2; exit 1; }

  echo "${package}:"
  mkdir -p "${out}"
  "${package}"
done

echo
echo "Fixtures written. Read the diff before committing — these are cluster contents."
