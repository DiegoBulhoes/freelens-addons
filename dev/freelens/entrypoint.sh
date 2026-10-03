#!/usr/bin/env bash
# Xvfb, openbox, x11vnc and noVNC, then Freelens in the foreground.
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*" >&2; }

cleanup() {
  local pid
  for pid in "${BG_PIDS[@]:-}"; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

BG_PIDS=()

rm -f "/tmp/.X${DISPLAY#:}-lock"

log "starting Xvfb on ${DISPLAY} at ${SCREEN_GEOMETRY}"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_GEOMETRY}" -nolisten tcp -ac &
BG_PIDS+=($!)

# Electron fails obscurely against a half-initialised X server.
for _ in $(seq 1 100); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
  log "FATAL: Xvfb did not come up on ${DISPLAY}"
  exit 1
fi
log "Xvfb is up"

openbox &
BG_PIDS+=($!)

log "starting x11vnc on :${VNC_PORT}"
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" \
       -forever -shared -nopw -quiet -noxdamage -bg >/dev/null

log "starting noVNC on :${NOVNC_PORT}"
websockify --web=/usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
BG_PIDS+=($!)

# Before Freelens: it reads the state file once, at boot.
node /usr/local/bin/seed-extensions.mjs || true

if [[ -r "${KUBECONFIG}" ]]; then
  log "kubeconfig present at ${KUBECONFIG}"
else
  log "WARNING: no readable kubeconfig at ${KUBECONFIG} — Freelens will start with no cluster"
fi

log "noVNC ready at http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=remote"

# The Chromium sandbox needs privileges the container lacks. FREELENS_EXTRA_ARGS is word-split.
# shellcheck disable=SC2086
exec dbus-run-session -- freelens \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  ${FREELENS_EXTRA_ARGS:-} \
  "$@"
