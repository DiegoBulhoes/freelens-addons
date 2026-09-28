#!/usr/bin/env bash
# Boots an X server, a window manager, a VNC server and the noVNC bridge, then
# hands the foreground to Freelens so the container's lifetime tracks the app's.
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

# Electron fails in confusing ways against a half-initialised X server, so wait
# for it to actually answer before going further.
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

# Without a window manager Electron's window has no frame and dialogs stack
# badly under VNC.
openbox &
BG_PIDS+=($!)

log "starting x11vnc on :${VNC_PORT}"
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" \
       -forever -shared -nopw -quiet -noxdamage -bg >/dev/null

log "starting noVNC on :${NOVNC_PORT}"
websockify --web=/usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
BG_PIDS+=($!)

# Must run before Freelens starts: it reads the state file once, at boot.
node /usr/local/bin/seed-extensions.mjs || true

if [[ -r "${KUBECONFIG}" ]]; then
  log "kubeconfig present at ${KUBECONFIG}"
else
  log "WARNING: no readable kubeconfig at ${KUBECONFIG} — Freelens will start with no cluster"
fi

log "noVNC ready at http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=remote"

# dbus-run-session gives Electron a private session bus. Without one it retries
# the system bus, fails, and logs an error on every start.
#
# --no-sandbox: the Chromium sandbox needs privileges the container does not get.
# --disable-gpu: there is no GPU behind Xvfb; without this Electron retries and logs noise.
# FREELENS_EXTRA_ARGS is how the e2e suite asks for --remote-debugging-port
# without a second image or a compose override. Empty in normal use.
# shellcheck disable=SC2086
exec dbus-run-session -- freelens \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  ${FREELENS_EXTRA_ARGS:-} \
  "$@"
