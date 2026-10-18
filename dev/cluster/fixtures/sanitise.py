"""Turns `kubectl get -o json` into a fixture safe to commit: host identifiers
replaced in shape, secrets and credentials removed, unread bulk dropped, and
`selfLink` filled in because the KubeObject constructor throws without it.
With --names-only, keeps only Secret names and cert-manager's annotations, from one or more
concatenated lists (one per namespace).
With --api, takes a Prometheus API answer instead of a kube list.
With --text, sanitises plain text (logs, metrics) line by line."""

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
K3S_APPLIED = "objectset.rio.cattle.io/applied"
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

# Every other kind's plural is its lowercase name plus "s"; a wrong one is a selfLink the
# KubeObject constructor rejects.
IRREGULAR_PLURAL = {"Ingress": "ingresses", "Prometheus": "prometheuses"}


def self_link_for(item: dict) -> str:
    api_version = item.get("apiVersion", "v1")
    metadata = item.get("metadata", {})
    plural = IRREGULAR_PLURAL.get(item.get("kind", ""), item.get("kind", "").lower() + "s")
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


WORKLOADS = {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob"}


def redact_env(variables) -> None:
    for variable in variables or []:
        if isinstance(variable, dict) and "value" in variable:
            variable["value"] = "redacted-by-fixture-export"


def redact_pod_spec(spec) -> None:
    if not isinstance(spec, dict):
        return

    for group in ("containers", "initContainers", "ephemeralContainers"):
        for container in spec.get(group) or []:
            if not isinstance(container, dict):
                continue

            redact_env(container.get("env"))

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


def drop_endpoint_params(node: dict) -> None:
    oauth2 = node.get("oauth2")

    if isinstance(oauth2, dict):
        oauth2.pop("endpointParams", None)


def sanitise(item: dict, seen: dict[str, str]) -> dict:
    metadata = item.setdefault("metadata", {})

    for key in DROPPED_METADATA:
        metadata.pop(key, None)

    metadata.setdefault("selfLink", self_link_for(item))

    # It repeats the applied manifest, so every field removed below would survive there.
    annotations = metadata.get("annotations")

    if isinstance(annotations, dict):
        annotations.pop(LAST_APPLIED, None)
        annotations.pop(K3S_APPLIED, None)

    operation_state = item.get("status", {}).get("operationState")

    if isinstance(operation_state, dict):
        operation_state.pop("syncResult", None)

    # Env values are where plain-text credentials sit; names stay, values go.
    kind = item.get("kind")
    spec = item.get("spec")

    if kind in ("Pod", "Prometheus", "PrometheusAgent", "Alertmanager"):
        redact_pod_spec(spec)
    elif kind in WORKLOADS and isinstance(spec, dict):
        template = (spec.get("jobTemplate", {}).get("spec", spec) if kind == "CronJob" else spec)
        redact_pod_spec(template.get("template", {}).get("spec"))
    elif kind == "Instrumentation" and isinstance(spec, dict):
        redact_env(spec.get("env"))
        for language in spec.values():
            if isinstance(language, dict):
                redact_env(language.get("env"))
    elif kind in ("Redis", "RedisReplication", "RedisCluster", "RedisSentinel") and isinstance(spec, dict):
        redact_env(spec.get("env"))
        for part in ("redisExporter", "redisLeader", "redisFollower"):
            redact_env((spec.get(part) or {}).get("env"))
        init = spec.get("initContainer")
        redact_pod_spec(
            {"containers": spec.get("sidecars"), "initContainers": [init] if isinstance(init, dict) else None}
        )
    elif kind == "MongoDBCommunity" and isinstance(spec, dict):
        redact_pod_spec((((spec.get("statefulSet") or {}).get("spec") or {}).get("template") or {}).get("spec"))
    elif kind == "Cluster" and item.get("apiVersion", "").startswith("postgresql.cnpg.io/") and isinstance(spec, dict):
        redact_env(spec.get("env"))
    elif kind == "OpenTelemetryCollector" and isinstance(spec, dict):
        redact_env(spec.get("env"))
        redact_env((spec.get("targetAllocator") or {}).get("env"))
        redact_pod_spec(
            {"containers": spec.get("additionalContainers"), "initContainers": spec.get("initContainers")}
        )
        config = spec.get("config")
        exporters = config.get("exporters") if isinstance(config, dict) else None

        # Exporter headers carry tokens, as remote write headers do.
        for exporter in (exporters or {}).values():
            if isinstance(exporter, dict):
                exporter.pop("headers", None)

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

    # ACME credentials: challenge tokens and keys, the account's key hash and email.
    if item.get("kind") == "Order":
        item.get("spec", {}).pop("request", None)
        item.get("status", {}).pop("certificate", None)

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

    # Credentials sit in remote-write/read headers, tokens and URLs, and in scrape params and proxies.
    if item.get("kind") in ("Prometheus", "PrometheusAgent") and isinstance(spec, dict):
        for field, path in (("remoteWrite", "write"), ("remoteRead", "read")):
            for remote in spec.get(field) or []:
                if isinstance(remote, dict):
                    for key in ("headers", "bearerToken", "proxyUrl"):
                        remote.pop(key, None)
                    drop_endpoint_params(remote)
                    if "url" in remote:
                        remote["url"] = f"https://redacted-by-fixture-export.example.test/api/v1/{path}"

        if isinstance(spec.get("apiserverConfig"), dict):
            spec["apiserverConfig"].pop("bearerToken", None)

    if item.get("kind") in ("ServiceMonitor", "PodMonitor", "ScrapeConfig") and isinstance(spec, dict):
        endpoints = spec.get("endpoints") or spec.get("podMetricsEndpoints") or []
        # A ScrapeConfig carries them at spec level.
        for endpoint in [spec] if item.get("kind") == "ScrapeConfig" else endpoints:
            if isinstance(endpoint, dict):
                endpoint.pop("proxyUrl", None)
                drop_endpoint_params(endpoint)
                if isinstance(endpoint.get("params"), dict):
                    endpoint["params"] = {key: ["redacted-by-fixture-export"] for key in endpoint["params"]}

        for key, configs in spec.items() if item.get("kind") == "ScrapeConfig" else []:
            for config in configs if key.endswith("SDConfigs") and isinstance(configs, list) else []:
                if isinstance(config, dict):
                    config.pop("proxyUrl", None)
                    config.pop("server", None)
                    drop_endpoint_params(config)
                    if isinstance(config.get("url"), str):
                        config["url"] = URL_QUERY.sub(r"\1", config["url"])

    node_info = item.get("status", {}).get("nodeInfo")

    if isinstance(node_info, dict):
        for key in ("machineID", "systemUUID", "bootID"):
            if key in node_info:
                node_info[key] = f"fixture-{key.lower()}"

    return walk(item, seen)


def names_only(document: dict) -> dict:
    return {
        "items": [
            {
                "metadata": {
                    "name": secret["metadata"]["name"],
                    "namespace": secret["metadata"]["namespace"],
                    "annotations": {
                        key: value
                        for key, value in (secret["metadata"].get("annotations") or {}).items()
                        if key.startswith("cert-manager.io/")
                    },
                }
            }
            for secret in document["items"]
        ]
    }


# A target's params come back as the scrape URL's query.
URL_QUERY = re.compile(r"(https?://[^\s\"?]+)\?[^\s\"]*")


def strip_queries(node):
    if isinstance(node, dict):
        return {key: strip_queries(value) for key, value in node.items()}

    if isinstance(node, list):
        return [strip_queries(value) for value in node]

    if isinstance(node, str):
        return URL_QUERY.sub(r"\1", node)

    return node


def api_answer(document: dict) -> dict:
    # discoveredLabels holds every meta label of the target, annotations included.
    for target in (document.get("data") or {}).get("activeTargets") or []:
        if isinstance(target, dict):
            target.pop("discoveredLabels", None)
            target.pop("globalUrl", None)

    return walk(strip_queries(document), {})


def concatenated(text: str) -> list[dict]:
    decoder, documents, at = json.JSONDecoder(), [], 0
    while True:
        at = WHITESPACE.match(text, at).end()
        if at == len(text):
            return documents
        document, at = decoder.raw_decode(text, at)
        documents.append(document)


WHITESPACE = re.compile(r"\s*")


def main() -> None:
    if sys.argv[1:] == ["--text"]:
        seen: dict[str, str] = {}
        for line in sys.stdin:
            sys.stdout.write(walk(line, seen))
        return

    # Secrets as the extensions read them: names and cert-manager's annotations, never a value.
    if sys.argv[1:] == ["--names-only"]:
        lists = concatenated(sys.stdin.read())
        merged = {"items": [item for each in lists for item in each.get("items", [])]}
        print(json.dumps(names_only(merged), indent=2))
        return

    document = json.load(sys.stdin)

    if sys.argv[1:] == ["--api"]:
        json.dump(api_answer(document), sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return

    seen: dict[str, str] = {}
    document["items"] = [sanitise(item, seen) for item in document.get("items", [])]
    document.pop("metadata", None)

    json.dump(document, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
