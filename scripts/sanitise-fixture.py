"""Turn `kubectl get -o json` output into a fixture that is safe to commit.

Four things happen here, in order of how much they matter:

1. **Identifiers that belong to the machine are replaced.** Node IP addresses,
   machine and system UUIDs, and the boot ID say nothing about how the code
   behaves and everything about the host. The shape is kept — an IPv4 address
   stays an IPv4 address — so anything parsing them still sees what it expects.

2. **`metadata.selfLink` is filled in.** The API server stopped sending it in
   Kubernetes 1.20, but Freelens' client derives it before constructing a
   `KubeObject`, and that constructor throws without it. A fixture missing it
   would not be a smaller version of reality, it would be one the application
   never sees.

3. **Secret values are removed.** A Secret keeps its type, its labels and its
   cert-manager annotations; its `data`, its `stringData` and every other
   annotation are dropped, whatever the Secret holds. CSRs and issued
   certificates go too: public, but base64 hides their DNS names from step 1.
   So do ACME's credentials — challenge tokens, wherever the challenge URL
   carries one, key authorisations, the account's key hash and email — and, on every kind, the annotation
   `kubectl apply` leaves, which repeats the manifest after the rest is gone.

4. **Fields no code reads are dropped.** `managedFields`,
   `status.operationState.syncResult` and an SbomReport's component list are
   most of the bytes and are never consulted — the SBOM's 154 reports go from
   58 MB to 182 KB without it. Everything that is read is kept exactly as the
   cluster reported it.
"""

import ipaddress
import json
import os
import re
import sys

# Documentation-only ranges (RFC 5737 / RFC 3849), so a leak is inert.
IPV4_REPLACEMENT = "198.51.100."
# RFC 2606 reserves this, so a redacted hostname resolves nowhere by design.
DOMAIN_REPLACEMENT = "example.test"
DROPPED_METADATA = ("managedFields",)
LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration"
# An HTTP-01 token travels in the URL the CA fetches, so it turns up wherever
# that URL does: the solver Ingress cert-manager creates, the Challenge's
# self-check message. Replaced in every string, not only in the token fields.
ACME_CHALLENGE_PATH = re.compile(r"(/\.well-known/acme-challenge/)[A-Za-z0-9_-]+")
ACME_TOKEN_REPLACEMENT = r"\1redacted-by-fixture-export"
CREDENTIAL_FLAG = re.compile(
    r"^(--?[\w.-]*(?:token|key|secret|password|passwd|credential)[\w.-]*=).+$", re.IGNORECASE
)

REDACTED_DOMAINS = [
    domain.strip()
    for domain in os.environ.get("FIXTURE_REDACT_DOMAINS", "").split(",")
    if domain.strip()
]

RESOURCE_PLURAL = {
    "Application": "applications",
    "AppProject": "appprojects",
    "ApplicationSet": "applicationsets",
    "Node": "nodes",
    "Event": "events",
    "VulnerabilityReport": "vulnerabilityreports",
    "ConfigAuditReport": "configauditreports",
    "ExposedSecretReport": "exposedsecretreports",
    "SbomReport": "sbomreports",
    "RbacAssessmentReport": "rbacassessmentreports",
    "ClusterComplianceReport": "clustercompliancereports",
    "ClusterRbacAssessmentReport": "clusterrbacassessmentreports",
    # Not every plural is the kind plus an "s", and a wrong one is a selfLink the
    # KubeObject constructor rejects.
    "Ingress": "ingresses",
}


def self_link_for(item: dict) -> str:
    api_version = item.get("apiVersion", "v1")
    metadata = item.get("metadata", {})
    plural = RESOURCE_PLURAL.get(item.get("kind", ""), item.get("kind", "").lower() + "s")
    prefix = "/api" if "/" not in api_version else "/apis"
    namespace = metadata.get("namespace")
    scope = f"/namespaces/{namespace}" if namespace else ""

    return f"{prefix}/{api_version}{scope}/{plural}/{metadata.get('name', '')}"


def replace_addresses(value: str, seen: dict[str, str]) -> str:
    def swap(match: re.Match[str]) -> str:
        original = match.group(0)

        try:
            address = ipaddress.ip_address(original)
        except ValueError:
            return original

        # Loopback and the in-cluster service address are not identifying and
        # are load-bearing in the code that reads them.
        if address.is_loopback:
            return original

        if original not in seen:
            seen[original] = f"{IPV4_REPLACEMENT}{len(seen) + 10}"

        return seen[original]

    return re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", swap, value)


def redact_domains(value: str) -> str:
    """Replace the operator's own domains, which say nothing about behaviour.

    The list comes from `.env`, not from this file: a real domain committed
    into the repository is exactly the leak this is meant to prevent. Only
    hostnames are touched — API group names like `argoproj.io` are the subject
    matter of these fixtures and are left alone.
    """
    for domain in REDACTED_DOMAINS:
        value = value.replace(domain, DOMAIN_REPLACEMENT)

    return value


def walk(node, seen: dict[str, str]):
    # Keys as well as values. An annotation can carry an address in its name —
    # k3s writes `listener.cattle.io/cn-<ip>` for every address its API server
    # answers on — and a walk over values alone replaced the value and left the
    # key, and the address, exactly where it was.
    if isinstance(node, dict):
        return {walk(key, seen): walk(value, seen) for key, value in node.items()}

    if isinstance(node, list):
        return [walk(value, seen) for value in node]

    if isinstance(node, str):
        return ACME_CHALLENGE_PATH.sub(
            ACME_TOKEN_REPLACEMENT, redact_domains(replace_addresses(node, seen))
        )

    return node


def sanitise(item: dict, seen: dict[str, str]) -> dict:
    metadata = item.setdefault("metadata", {})

    for key in DROPPED_METADATA:
        metadata.pop(key, None)

    metadata.setdefault("selfLink", self_link_for(item))

    # `kubectl apply` records the manifest it applied in an annotation, so every
    # field removed below would survive there — an ACME issuer's email, a
    # Secret's values. Nothing reads it, on any kind.
    annotations = metadata.get("annotations")

    if isinstance(annotations, dict):
        annotations.pop(LAST_APPLIED, None)

    operation_state = item.get("status", {}).get("operationState")

    if isinstance(operation_state, dict):
        operation_state.pop("syncResult", None)

    # A Pod's environment is the most likely place for a credential to be
    # sitting in plain text — this cluster has 401 literal values across its
    # pods. Nothing here reads them: a pod is shown by name, phase and owner.
    # The variable names are kept so the shape stays real; only values go.
    if item.get("kind") == "Pod":
        spec = item.get("spec")

        if isinstance(spec, dict):
            for group in ("containers", "initContainers", "ephemeralContainers"):
                for container in spec.get(group) or []:
                    if not isinstance(container, dict):
                        continue

                    for variable in container.get("env") or []:
                        if isinstance(variable, dict) and "value" in variable:
                            variable["value"] = "redacted-by-fixture-export"

                    # A credential passed as a flag rather than through the
                    # environment: cert-manager's ACME solver takes its challenge
                    # token and key authorisation this way. The flag stays, so the
                    # shape does; the value goes.
                    for field in ("args", "command"):
                        values = container.get(field)
                        if isinstance(values, list):
                            container[field] = [
                                CREDENTIAL_FLAG.sub(r"\1redacted-by-fixture-export", value)
                                if isinstance(value, str)
                                else value
                                for value in values
                            ]

                    container.pop("envFrom", None)

    # A Secret is the one kind whose values are the secret. `data` and
    # `stringData` go outright — not redacted, removed: nothing reads them, and
    # a TLS Secret's `tls.key` is a private key. So does the annotation
    # `kubectl apply` leaves behind, because it is the whole applied manifest,
    # values included. Type, labels and the remaining annotations are kept:
    # they are what says which Certificate, if any, manages the Secret.
    if item.get("kind") == "Secret":
        item.pop("data", None)
        item.pop("stringData", None)
        # Of its annotations, only cert-manager's are read — they say which
        # Certificate, if any, manages the Secret. The rest go: the last-applied
        # one repeats the values, and the ones other tools write describe the
        # machine — k3s lists every hostname and address its API server serves.
        annotations = metadata.get("annotations")

        if isinstance(annotations, dict):
            metadata["annotations"] = {
                key: value
                for key, value in annotations.items()
                if key.startswith("cert-manager.io/")
            }

    # A certificate signing request, and the certificate and CA it produced,
    # are public — but base64 hides the DNS names inside them from the domain
    # redaction below, which only reads plain text. Nothing here parses them:
    # expiry comes from the Certificate's status.
    if item.get("kind") == "CertificateRequest":
        item.get("spec", {}).pop("request", None)

        # Who asked for it: the requester's username, groups, uid and the extra
        # attributes the API server attaches — the node it ran on, the pod, the
        # token's id. For cert-manager's own requests that is a service account;
        # for one made by hand it is a person. Nothing here reads either.
        for key in ("username", "groups", "uid", "extra"):
            item.get("spec", {}).pop(key, None)

        for key in ("certificate", "ca"):
            item.get("status", {}).pop(key, None)

    if item.get("kind") == "Order":
        item.get("spec", {}).pop("request", None)
        item.get("status", {}).pop("certificate", None)

    # ACME is a conversation with the CA, and cert-manager keeps its side of it
    # in the objects: each challenge's token and key authorisation, and on the
    # issuer the hash of the account's private key and the email it registered
    # with — a person's, on a real cluster. Gitleaks reads the tokens as API
    # keys, rightly. Nothing here reads any of them: a challenge is shown by its
    # state and reason, an issuer by whether it is ready.
    if item.get("kind") == "Order":
        for authorization in item.get("status", {}).get("authorizations") or []:
            for challenge in authorization.get("challenges") or []:
                if isinstance(challenge, dict):
                    challenge.pop("token", None)

    if item.get("kind") == "Challenge":
        for key in ("token", "key"):
            item.get("spec", {}).pop(key, None)

    if item.get("kind") in ("Issuer", "ClusterIssuer"):
        acme = item.get("spec", {}).get("acme")

        if isinstance(acme, dict):
            acme.pop("email", None)

        account = item.get("status", {}).get("acme")

        if isinstance(account, dict):
            for key in ("lastPrivateKeyHash", "lastRegisteredEmail"):
                account.pop(key, None)

    # An ExposedSecretReport names the matched text. This cluster reports none,
    # but a fixture refreshed against one that does would commit the secret
    # itself. The finding's rule, target and severity are what gets read.
    if item.get("kind") in ("ExposedSecretReport", "ClusterExposedSecretReport"):
        for secret in (item.get("report") or {}).get("secrets") or []:
            if isinstance(secret, dict):
                secret.pop("match", None)

    # An SbomReport carries the whole component tree — 590 entries for one
    # image, 58 MB across the cluster. Coverage is decided from the report's
    # labels and summary; nothing reads the inventory itself.
    if item.get("kind") == "SbomReport":
        report = item.get("report")

        if isinstance(report, dict):
            report.pop("components", None)

    node_info = item.get("status", {}).get("nodeInfo")

    if isinstance(node_info, dict):
        for key in ("machineID", "systemUUID", "bootID"):
            if key in node_info:
                node_info[key] = f"fixture-{key.lower()}"

    return walk(item, seen)


def main() -> None:
    document = json.load(sys.stdin)
    seen: dict[str, str] = {}
    document["items"] = [sanitise(item, seen) for item in document.get("items", [])]
    document.pop("metadata", None)

    json.dump(document, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
