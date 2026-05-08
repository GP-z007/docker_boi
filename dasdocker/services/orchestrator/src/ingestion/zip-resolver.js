'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Maximum upload size before any central-directory parse (Rule 1 — ZTA / T-S03-004).
 * WHY 256MiB: bounds attacker-controlled archive bytes read by the orchestrator process.
 */
const MAX_ZIP_UPLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Per-entry uncompressed cap (zip bomb / resource guard).
 * WHY 1GiB: aligns with mandate; single entry must not expand past this before write.
 */
const MAX_ENTRY_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

/** Zip bomb ratio: uncompressed must not exceed 10× compressed for non-stored entries. */
const ZIP_BOMB_RATIO = 10;

/** Linux / zip "symlink" file type in high 16 bits of external attributes (Info-ZIP convention). */
const UNIX_S_IFLNK = 0o120000;
const UNIX_MODE_MASK = 0o170000;

/**
 * @param {number} attr external file attributes from ZIP central directory
 * @returns {boolean}
 */
function isUnixSymlinkZipAttr(attr) {
  const hostMode = (attr >>> 16) & 0xffff;
  const fileType = hostMode & UNIX_MODE_MASK;
  return fileType === UNIX_S_IFLNK;
}

/**
 * Validate a single archive member path before extraction (T-S03-002).
 * Rejects traversal, absolute paths, Windows ABS paths, and sensitive targets.
 *
 * @param {string} entryName raw entry path from ZIP (may use / or \)
 * @returns {{ ok: true, posixPath: string } | { ok: false, reason: string }}
 */
function validateZipEntryPath(entryName) {
  if (typeof entryName !== 'string' || entryName.includes('\0')) {
    return { ok: false, reason: 'ZIP_ENTRY_INVALID' };
  }
  const norm = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = norm.split('/');

  const lowerSegs = segments.map((s) => s.toLowerCase());
  if (segments.some((s) => s === '..')) {
    return { ok: false, reason: 'ZIP_PATH_TRAVERSAL' };
  }
  // Absolute / residual tricks
  if (path.posix.isAbsolute(norm) || /^[a-z]:/i.test(entryName.trim())) {
    return { ok: false, reason: 'ZIP_ABSOLUTE_PATH' };
  }
  // Sensitive names (hosted multi-tenant ingest — deny host metadata paths outright)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const low = seg.toLowerCase();
    if (low === '.git') {
      return { ok: false, reason: 'ZIP_SENSITIVE_DOT_GIT' };
    }
    if (low === 'etc' && i === 0) {
      return { ok: false, reason: 'ZIP_SENSITIVE_ETC' };
    }
    if (low === '.ssh') {
      return { ok: false, reason: 'ZIP_SENSITIVE_SSH_DIR' };
    }
    if (low === 'authorized_keys') {
      return { ok: false, reason: 'ZIP_SENSITIVE_AUTHORIZED_KEYS' };
    }
  }
  if (segments.some((s) => s.startsWith('~'))) {
    return { ok: false, reason: 'ZIP_SENSITIVE_TILDE' };
  }
  if (lowerSegs.includes('passwd') && lowerSegs.includes('etc')) {
    return { ok: false, reason: 'ZIP_SENSITIVE_PASSWD_PATH' };
  }

  const joinedUnderEmpty = path.posix.normalize('/' + segments.join('/'));
  const relative = joinedUnderEmpty.replace(/^\/?/, '');
  const resolvedProbe = path.posix.normalize(path.posix.join('/fake-root', relative));
  if (resolvedProbe.startsWith('/fake-root/..') || resolvedProbe === '/fake-root/..') {
    return { ok: false, reason: 'ZIP_PATH_NORMALIZE_ESCAPE' };
  }

  return { ok: true, posixPath: relative };
}

/**
 * @param {number} uncomp
 * @param {number} comp
 */
function entryFailsZipBombHeuristic(uncomp, comp) {
  if (uncomp > MAX_ENTRY_UNCOMPRESSED_BYTES) return true;
  if (comp > 0 && uncomp > ZIP_BOMB_RATIO * comp) return true;
  return false;
}

/**
 * Archive-level zip bomb check (aggregate).
 * @param {number} totalUncomp
 * @param {number} totalComp
 */
function archiveFailsZipBombHeuristic(totalUncomp, totalComp) {
  if (totalUncomp > MAX_ENTRY_UNCOMPRESSED_BYTES) return true;
  if (totalComp > 0 && totalUncomp > ZIP_BOMB_RATIO * totalComp) return true;
  return false;
}

/**
 * Ensure resolved write path stays under destDir (final zip-slip guard).
 * @param {string} destDir
 * @param {string} relativePosix
 */
function assertResolvedUnderRoot(destDir, relativePosix) {
  const target = path.resolve(destDir, ...relativePosix.split('/').filter(Boolean));
  const root = path.resolve(destDir);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('ZIP_SLIP_RESOLVED'), { code: 'ZIP_SLIP_RESOLVED' });
  }
  return target;
}

/**
 * Extract buffer to destDir with hardened validation (no symlink writes, no traversal).
 *
 * @param {Buffer} buffer
 * @param {string} destDir
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, detail?: string }>}
 */
async function extractZipBuffer(buffer, destDir) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ZIP_UPLOAD_BYTES) {
    return { ok: false, reason: 'ZIP_TOO_LARGE', detail: String(buffer?.length ?? 0) };
  }

  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (e) {
    return { ok: false, reason: 'ZIP_PARSE_ERROR', detail: String(e) };
  }

  const entries = zip.getEntries();
  let totalUncomp = 0;
  let totalComp = 0;

  for (const entry of entries) {
    const nameRaw = entry.entryName;
    const pathCheck = validateZipEntryPath(nameRaw);
    if (!pathCheck.ok) {
      return { ok: false, reason: pathCheck.reason, detail: nameRaw };
    }
    if (isUnixSymlinkZipAttr(entry.attr || 0)) {
      return { ok: false, reason: 'ZIP_SYMLINK_FORBIDDEN', detail: nameRaw };
    }
    const uh = entry.header;
    const uncomp = typeof uh.size === 'number' ? uh.size : 0;
    const comp = typeof uh.compressedSize === 'number' ? uh.compressedSize : 0;
    totalUncomp += uncomp;
    totalComp += comp;
    if (entryFailsZipBombHeuristic(uncomp, comp)) {
      return {
        ok: false,
        reason: 'ZIP_BOMB_ENTRY',
        detail: `${nameRaw}:${uncomp}:${comp}`,
      };
    }
  }

  if (archiveFailsZipBombHeuristic(totalUncomp, totalComp)) {
    return {
      ok: false,
      reason: 'ZIP_BOMB_ARCHIVE',
      detail: `${totalUncomp}:${totalComp}`,
    };
  }

  await fsp.mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    const pathCheck = validateZipEntryPath(entry.entryName);
    if (!pathCheck.ok) {
      return { ok: false, reason: pathCheck.reason, detail: entry.entryName };
    }
    const rel = pathCheck.posixPath;
    if (entry.isDirectory) {
      const dirTarget = assertResolvedUnderRoot(destDir, rel + '/');
      await fsp.mkdir(dirTarget, { recursive: true });
      continue;
    }
    const fileTarget = assertResolvedUnderRoot(destDir, rel);
    await fsp.mkdir(path.dirname(fileTarget), { recursive: true });
    const data = entry.getData();
    if (!Buffer.isBuffer(data)) {
      return { ok: false, reason: 'ZIP_ENTRY_READ_FAILED', detail: entry.entryName };
    }
    await fsp.writeFile(fileTarget, data, { mode: 0o644, flag: 'wx' });
  }

  return { ok: true };
}

module.exports = {
  MAX_ZIP_UPLOAD_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  ZIP_BOMB_RATIO,
  validateZipEntryPath,
  isUnixSymlinkZipAttr,
  entryFailsZipBombHeuristic,
  archiveFailsZipBombHeuristic,
  extractZipBuffer,
  assertResolvedUnderRoot,
};
