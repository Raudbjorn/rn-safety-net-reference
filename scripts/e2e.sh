#!/usr/bin/env bash
# End-to-end: for each Maestro flow, start a FRESH gateway, run the flow against the app on the
# connected Android emulator/device, then check the gateway holds exactly one record (no loss, no duplicate).
# The app is expected to be installed already; the emulator reaches this host as 10.0.2.2.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
GATEWAY_PID=""

command -v maestro >/dev/null || { echo "maestro is not on PATH" >&2; exit 2; }
adb get-state >/dev/null 2>&1 || { echo "no Android device or emulator connected" >&2; exit 2; }

stop_gateway() { [[ -n "$GATEWAY_PID" ]] && kill "$GATEWAY_PID" 2>/dev/null || true; GATEWAY_PID=""; }
trap stop_gateway EXIT

start_gateway() {
  PORT="$PORT" FAULTS=1 node --import tsx server/main.ts >/dev/null &
  GATEWAY_PID=$!
  for _ in $(seq 1 40); do curl -fs "$BASE/health" >/dev/null 2>&1 && return 0; sleep 0.25; done
  echo "gateway did not become healthy" >&2; return 1
}

status=0
for flow in .maestro/[0-9]*.yaml; do
  echo "== $flow"
  start_gateway
  # The "lost reply" flow needs the gateway to store the next drill and then drop the connection.
  [[ "$flow" == *lost_reply* ]] && curl -fsS -X POST "$BASE/__fault/drop-next-reply" >/dev/null
  if ! maestro test "$flow"; then echo "FAIL (flow): $flow"; status=1; stop_gateway; continue; fi
  count=$(curl -fsS "$BASE/v1/drills" | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>console.log(JSON.parse(b).count))')
  [[ "$count" == "1" ]] || { echo "FAIL (gateway holds $count records, expected exactly 1): $flow"; status=1; }
  stop_gateway
done
exit "$status"
