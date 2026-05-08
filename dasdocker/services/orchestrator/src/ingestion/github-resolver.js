'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

/**
 * Strict allow-listed GitHub HTTPS URL shape (Rule 1 — ZTA / T-S03-001).
 * WHY regex allowlist (not denylist): only github.com repos with alphanumeric org/repo segments
 * are accepted; rejects SSRF payloads, credential-in-URL tricks, branch fragments, non-HTTPS schemes.
 */
const GITHUB_URL_REGEX =
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/;

/** @type {readonly number} WHY 512MiB caps disk blow-up during shallow clone (T-S03-004). */
const MAX_CLONE_BYTES = 512 * 1024 * 1024;

/** @type {readonly number} WHY 120s bounds hung git processes starving the worker pool (T-S03-004). */
const CLONE_TIMEOUT_MS = 120_000;

/** @type {readonly number} Polled `du` interval during clone — trade-off: responsiveness vs CPU. */
const DU_POLL_MS = 750;

function validateGithubUrl(url) {
  if (typeof url !== 'string') {
    return { ok: false, reason: 'URL_NOT_STRING' };
  }
  const trimmed = url.trim();
  if (!GITHUB_URL_REGEX.test(trimmed)) {
    return { ok: false, reason: 'GITHUB_URL_NOT_ALLOWLISTED' };
  }
  return { ok: true, url: trimmed };
}

/**
 * @param {string} dir
 * @param {{ spawn?: typeof spawn, logger?: { warn?: Function } }} [_opts]
 */
function duBytes(dir, _opts = {}) {
  const sp = _opts.spawn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = sp('du', ['-sk', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 || !out.trim()) {
        resolve(0);
        return;
      }
      const kb = parseInt(out.trim().split(/\s+/)[0], 10);
      if (Number.isNaN(kb)) {
        resolve(0);
        return;
      }
      resolve(kb * 1024);
    });
  });
}

/**
 * Shallow single-branch clone into `destDir` (directory must not exist yet).
 * Static operation only: runs `git` binary; never executes repo contents.
 *
 * @param {{
 *   url: string,
 *   destDir: string,
 *   logger?: { info?: Function, warn?: Function, error?: Function },
 *   spawnImpl?: typeof spawn,
 *   maxCloneBytes?: number,
 *   timeoutMs?: number,
 * }} params
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, detail?: string }>}
 */
async function cloneGithubRepository(params) {
  const {
    url,
    destDir,
    logger = console,
    spawnImpl = spawn,
    maxCloneBytes = MAX_CLONE_BYTES,
    timeoutMs = CLONE_TIMEOUT_MS,
  } = params;

  const v = validateGithubUrl(url);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }
  const cloneUrl = v.url;

  await fsp.mkdir(path.dirname(destDir), { recursive: true });

  return new Promise((resolve) => {
    const git = spawnImpl(
      'git',
      ['clone', '--depth=1', '--single-branch', cloneUrl, destDir],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    git.stderr.on('data', (c) => {
      stderr += c.toString();
    });

    const timeout = setTimeout(() => {
      git.kill('SIGKILL');
      resolve({ ok: false, reason: 'CLONE_TIMEOUT', detail: String(timeoutMs) });
    }, timeoutMs);

    const duTimer = setInterval(async () => {
      try {
        const exists = fs.existsSync(destDir);
        if (!exists) return;
        const bytes = await duBytes(destDir, { spawn: spawnImpl });
        if (bytes > maxCloneBytes) {
          git.kill('SIGKILL');
          clearInterval(duTimer);
          clearTimeout(timeout);
          resolve({
            ok: false,
            reason: 'CLONE_SIZE_EXCEEDED',
            detail: `${bytes}>${maxCloneBytes}`,
          });
        }
      } catch (e) {
        logger.warn?.({ msg: 'github-resolver: du poll failed', err: String(e) });
      }
    }, DU_POLL_MS);

    git.on('error', (err) => {
      clearInterval(duTimer);
      clearTimeout(timeout);
      resolve({ ok: false, reason: 'GIT_SPAWN_FAILED', detail: err.message });
    });

    git.on('close', async (code) => {
      clearInterval(duTimer);
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({
          ok: false,
          reason: 'CLONE_FAILED',
          detail: stderr.slice(0, 2048),
        });
        return;
      }
      try {
        const gitMeta = path.join(destDir, '.git');
        await fsp.rm(gitMeta, { recursive: true, force: true });
      } catch (e) {
        resolve({ ok: false, reason: 'GIT_METADATA_STRIP_FAILED', detail: String(e) });
        return;
      }
      resolve({ ok: true });
    });
  });
}

module.exports = {
  GITHUB_URL_REGEX,
  MAX_CLONE_BYTES,
  CLONE_TIMEOUT_MS,
  validateGithubUrl,
  cloneGithubRepository,
  duBytes,
};
