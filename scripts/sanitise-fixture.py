"""Turns `kubectl get -o json` into a fixture safe to commit: host identifiers
replaced in shape, secrets and credentials removed, unread bulk dropped, and
`selfLink` filled in because the KubeObject constructor throws without it."""

import ipaddress
import json
import os
import re
import sys

# Documentation-only range (RFC 5737), so a leak is inert.
IPV4_REPLACEMENT = "198.51.100."
DOMAIN_REPLACEMENT = "example.test"
DROPPED_METADATA = ("managedFields",)
LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration"
# The HTTP-01 token is in the challenge URL, which appears in many strings.
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
    # A wrong plural is a selfLink the KubeObject constructor rejects.
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

        if address.is_loopback:
            return original

        if original not in seen:
            seen[original] = f"{IPV4_REPLACEMENT}{len(seen) + 10}"

        return seen[original]

    return re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", swap, value)


def redact_domains(value: str) -> str:
    # The list comes from `.env`: a real domain written here would be the leak.
    for domain in REDACTED_DOMAINS:
        value = value.replace(domain, DOMAIN_REPLACEMENT)

    return value


def walk(node, seen: dict[str, str]):
    # Keys too: k3s writes annotations named `listener.cattle.io/cn-<ip>`.
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

    # It repeats the applied manifest, so every field removed below would survive there.
    annotations = metadata.get("annotations")

    if isinstance(annotations, dict):
        annotations.pop(LAST_APPLIED, None)

    operation_state = item.get("status", {}).get("operationState")

    if isinstance(operation_state, dict):
        operation_state.pop("syncResult", None)

    # Env values are where plain-text credentials sit; names stay, values go.
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

                    # cert-manager's ACME solver takes its token and key as flags.
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

    if item.get("kind") == "Secret":
        item.pop("data", None)
        item.pop("stringData", None)
        # Only cert-manager's annotations are read; k3s's list the host's names and addresses.
        annotations = metadata.get("annotations")

        if isinstance(annotations, dict):
            metadata["annotations"] = {
                key: value
                for key, value in annotations.items()
                if key.startswith("cert-manager.io/")
            }

    # Base64 hides their DNS names from the domain redaction.
    if item.get("kind") == "CertificateRequest":
        item.get("spec", {}).pop("request", None)

        # The requester's identity: a person, for a request made by hand.
        for key in ("username", "groups", "uid", "extra"):
            item.get("spec", {}).pop(key, None)

        for key in ("certificate", "ca"):
            item.get("status", {}).pop(key, None)

    if item.get("kind") == "Order":
        item.get("spec", {}).pop("request", None)
        item.get("status", {}).pop("certificate", None)

    # ACME credentials: challenge tokens and keys, the account's key hash and email.
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

    # `match` is the exposed secret itself.
    if item.get("kind") in ("ExposedSecretReport", "ClusterExposedSecretReport"):
        for secret in (item.get("report") or {}).get("secrets") or []:
            if isinstance(secret, dict):
                secret.pop("match", None)

    # Unread, and most of the bytes.
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
