#!/usr/bin/env bash
# Layer 2 dead-man reconcile — survives missed Redis NOTIFY events / transient clock skew at the daemon.
# [Rule 1] `WATCHDOG_JWT_PATH` is supplied by Vault; never bake credentials into unit files checked into git.
set -euo pipefail

: "${ORCHESTRATOR_URL:?set ORCHESTRATOR_URL}"
: "${WATCHDOG_JWT_PATH:?set WATCHDOG_JWT_PATH}"
GRACE_SECONDS="${WATCHDOG_GRACE_SECONDS:-15}"

NOW="$(date -u +%s)"
TOKEN="$(tr -d '\n' <"${WATCHDOG_JWT_PATH}")"
RESPONSE_FILE="$(mktemp)"

cleanup() {
  rm -f "${RESPONSE_FILE}"
}
trap cleanup EXIT

curl -sfS "${ORCHESTRATOR_URL}/api/v1/sessions" -H "Authorization: Bearer ${TOKEN}" >"${RESPONSE_FILE}"

export ORCHESTRATOR_URL TOKEN NOW GRACE_SECONDS RESPONSE_FILE

node <<'NODE'
const fs = require('fs');
const { spawnSync } = require('child_process');

function parseIso(ts) {
  const d = new Date(ts.endsWith('Z') ? ts : `${ts}`);
  const n = d.getTime() / 1000;
  return Number.isFinite(n) ? n : NaN;
}

const path = process.env.RESPONSE_FILE;
const orch = process.env.ORCHESTRATOR_URL.trim();
const token = process.env.TOKEN.trim();
const NOW = Number(process.env.NOW);
const GRACE = Number(process.env.GRACE_SECONDS || '15');

const data = JSON.parse(fs.readFileSync(path, 'utf8'));

for (const row of data.sessions || []) {
  const sid = row.id;
  const st = row.state || '';
  if (!sid || st === 'DESTROYED' || st === 'DESTROYING') continue;

  const meta = row.meta || {};
  const ttl = Number(meta.ttl_seconds || 0);
  const created = meta.created_at;
  if (ttl <= 0 || typeof created !== 'string') continue;

  const ts = parseIso(created);
  if (!Number.isFinite(ts)) continue;

  if (NOW > ts + ttl + GRACE) {
    spawnSync(
      'curl',
      ['-sfS', '-X', 'DELETE', `${orch}/api/v1/sessions/${sid}`, '-H', `Authorization: Bearer ${token}`],
      { stdio: 'inherit' },
    );
  }
}
NODE
