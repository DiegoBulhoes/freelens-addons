#!/usr/bin/env bash
# ci.yaml through act, as another project on other ports.
# Usage: dev/act/run.sh [job]; JOB=, LEG= and KEEP=1 (keeps the last setup) as env.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

JOB=${1:-${JOB:-}}
docker build -t freelens-addons/act:local dev/act
mkdir -p /tmp/freelens-addons-act
docker run --rm --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock -v "${PWD}:/repo:ro" \
  -v /tmp/freelens-addons-act:/tmp/freelens-addons-act \
  -e USER_UID="$(id -u)" -e USER_GID="$(id -g)" -e KEEP="${KEEP:-}" -e LEG="${LEG:-}" \
  freelens-addons/act:local ci-local ${JOB:+"${JOB}"}
