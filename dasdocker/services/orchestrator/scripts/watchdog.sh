#!/usr/bin/env bash
# WHY 60-second cron pairing: aligns with Dispatch 03/04 watchdog interval (recovery ≤ one poll sweep).
set -euo pipefail
export DASDOCKER_ORCHESTRATOR_URL="${DASDOCKER_ORCHESTRATOR_URL:-http://127.0.0.1:8080}"
export DASDOCKER_WATCHDOG_JWT="${DASDOCKER_WATCHDOG_JWT:?missing DASDOCKER_WATCHDOG_JWT}"

ROOT="$(cd "$(dirname "$0")"/.. && pwd)"
curl -fsS \
  -H "Authorization: Bearer ${DASDOCKER_WATCHDOG_JWT}" \
  "${DASDOCKER_ORCHESTRATOR_URL}/api/v1/sessions" \
  | node "${ROOT}/scripts/watchdog-runner.cjs"
