'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');

/**
 * ClamAV pre-scan via clamdscan (Rule 1 — ZTA — fail-safe: no positives → block session if scanner down).
 * WHY subprocess (not embedding libclamav): least privilege — isolate AV parser crashes; ops pins clamd separately.
 */

/** WHY 60s: bound AV latency so poisoned paths cannot stall ingestion workers indefinitely (T-S03-004). */
const DEFAULT_CLAM_SCAN_TIMEOUT_MS = 60_000;

const CLAMDSCAN_ARGS = ['--no-summary', '--fdpass'];

/**
 * Parse clamdscan stdout/stderr for "FOUND" signatures.
 * @param {string} out
 * @returns {string[]}
 */
function parseClamDetections(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hits = [];
  for (const line of lines) {
    if (/:\s*[A-Za-z0-9._-]+\s+FOUND\b/i.test(line)) {
      hits.push(line);
    }
  }
  return hits;
}

/**
 * @param {string} sourceRoot
 * @param {{
 *   timeoutMs?: number,
 *   clamdscanPath?: string,
 *   spawnImpl?: typeof spawn,
 *   logger?: { info?: Function, warn?: Function, error?: Function },
 * }} [opts]
 * @returns {Promise<
 *   | { ok: true }
 *   | { ok: false, reason: 'MALWARE_DETECTED', detections: string[] }
 *   | { ok: false, reason: 'SCANNER_UNAVAILABLE'|'SCAN_TIMEOUT'|'SCAN_ERROR', detail?: string }
 * >}
 */
function scanTreeWithClamAV(sourceRoot, opts = {}) {
  const {
    timeoutMs = DEFAULT_CLAM_SCAN_TIMEOUT_MS,
    clamdscanPath = 'clamdscan',
    spawnImpl = spawn,
    logger = console,
  } = opts;

  return new Promise((resolve) => {
    const child = spawnImpl(clamdscanPath, [...CLAMDSCAN_ARGS, sourceRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c) => {
      stderr += c.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, reason: 'SCAN_TIMEOUT', detail: String(timeoutMs) });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.warn?.({ msg: 'pre-scanner: clamdscan spawn failed — fail-safe reject', err: String(err) });
      resolve({ ok: false, reason: 'SCANNER_UNAVAILABLE', detail: err.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const detections = parseClamDetections(combined);
      // clamdscan: 0 = OK, 1 = FOUND, >1 typically error contacting daemon — treat as fail-safe rejection
      if (code === 0 && detections.length === 0) {
        resolve({ ok: true });
        return;
      }
      if (code === 1 || detections.length > 0) {
        resolve({ ok: false, reason: 'MALWARE_DETECTED', detections });
        return;
      }
      logger.warn?.({
        msg: 'pre-scanner: clamdscan non-success exit — fail-safe reject',
        code,
        tail: combined.slice(-512),
      });
      resolve({
        ok: false,
        reason: 'SCANNER_UNAVAILABLE',
        detail: combined.slice(0, 512) || `exit_${code}`,
      });
    });
  });
}

/**
 * Optional VirusTotal gate (Vault-fed API key MUST map to VIRUSTOTAL_API_KEY env — never embedded).
 * WHY optional second opinion: strengthens supply-chain verdicts when Squad A enables it; default off.
 *
 * @param {string} sourceRoot
 * @param {{ fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv, logger?: { warn?: Function } }} [_opts]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, detail?: string }>}
 */
async function optionalVirusTotalScan(sourceRoot, _opts = {}) {
  const env = _opts.env ?? process.env;
  const key = env.VIRUSTOTAL_API_KEY;
  if (!key || key.length < 16) {
    return { ok: true };
  }
  const fetchImpl = _opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) {
    _opts.logger?.warn?.({ msg: 'pre-scanner: fetch unavailable — skipping VirusTotal' });
    return { ok: true };
  }

  let candidatePath = '';
  pick: {
    for (const name of ['package.json', 'README.md']) {
      const p = path.join(sourceRoot, name);
      try {
        const st = await fsp.stat(p);
        if (st.isFile() && st.size <= 32 * 1024 * 1024) {
          candidatePath = p;
          break pick;
        }
      } catch {
        /* continue */
      }
    }
    const entries = await fsp.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const p = path.join(sourceRoot, ent.name);
      try {
        const st = await fsp.stat(p);
        if (st.size <= 32 * 1024 * 1024) {
          candidatePath = p;
          break pick;
        }
      } catch {
        /* continue */
      }
    }
  }
  if (!candidatePath) {
    return { ok: true };
  }

  const buf = await fsp.readFile(candidatePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  let res;
  try {
    res = await fetchImpl(`https://www.virustotal.com/api/v3/files/${hash}`, {
      headers: { 'x-apikey': key },
    });
  } catch (e) {
    return { ok: false, reason: 'VIRUSTOTAL_ERROR', detail: String(e) };
  }

  if (!res.ok) {
    if (res.status === 404) return { ok: true };
    return {
      ok: false,
      reason: 'VIRUSTOTAL_ERROR',
      detail: `${res.status}`,
    };
  }

  /** @type {{ data?: { attributes?: { last_analysis_stats?: { malicious?: number, suspicious?: number } } } }} */
  const body = await res.json().catch(() => ({}));
  const malicious = body?.data?.attributes?.last_analysis_stats?.malicious ?? 0;
  const suspicious = body?.data?.attributes?.last_analysis_stats?.suspicious ?? 0;
  if (malicious > 0 || suspicious > 0) {
    return {
      ok: false,
      reason: 'VIRUSTOTAL_POSITIVE',
      detail: `${path.basename(candidatePath)} m=${malicious} s=${suspicious}`,
    };
  }

  return { ok: true };
}

module.exports = {
  DEFAULT_CLAM_SCAN_TIMEOUT_MS,
  scanTreeWithClamAV,
  parseClamDetections,
  optionalVirusTotalScan,
};
