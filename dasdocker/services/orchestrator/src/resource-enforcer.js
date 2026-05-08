'use strict';

/**
 * WHY cgroup knobs here (Rule 1 — ZTA): every sandbox gets identical PID + memory envelopes — callers cannot widen
 * without editing this module + Squad A review (T-S04-004 / fork bomb & OOM class).
 */

/** Max PIDs inside one session — fork bombs exhaust this slice, not the host (VT-RED-S04). */
const DEFAULT_PIDS_LIMIT = 256;

/** WHY 512MiB: aligns with tmpfs workspace quota (agent-09) so OOM and ENOSPC fail together predictably. */
const DEFAULT_MEMORY_BYTES = 512 * 1024 * 1024;

/**
 * @typedef {{
 *   pidsLimit?: number,
 *   memoryBytes?: number,
 *   cpuQuota?: number,
 *   cpuPeriod?: number,
 * }} ResourceProfile
 */

/**
 * Returns Docker CLI flag fragments (argv tokens) — never raw user input.
 *
 * @param {ResourceProfile} [profile]
 * @returns {string[]}
 */
function dockerResourceCliArgs(profile = {}) {
  const envMb = process.env.DASDOCKER_TEST_MEMORY_MB
    ? Number(process.env.DASDOCKER_TEST_MEMORY_MB)
    : null;
  const pids =
    profile.pidsLimit ??
    (process.env.DASDOCKER_TEST_PIDS_LIMIT ? Number(process.env.DASDOCKER_TEST_PIDS_LIMIT) : DEFAULT_PIDS_LIMIT);
  const baseMem = envMb != null && !Number.isNaN(envMb) ? envMb * 1024 * 1024 : DEFAULT_MEMORY_BYTES;
  const mem = profile.memoryBytes ?? baseMem;
  const memMb = Math.max(32, Math.floor(mem / (1024 * 1024)));
  return [
    '--pids-limit',
    String(pids),
    '--memory',
    `${memMb}m`,
    '--memory-swap',
    `${memMb}m`,
  ];
}

/**
 * @param {ResourceProfile} [profile]
 * @returns {{ PidsLimit: number, Memory: number, MemorySwap: number }}
 */
function dockerResourceHostConfig(profile = {}) {
  const pids = profile.pidsLimit ?? DEFAULT_PIDS_LIMIT;
  const mem = profile.memoryBytes ?? DEFAULT_MEMORY_BYTES;
  return {
    PidsLimit: pids,
    Memory: mem,
    MemorySwap: mem,
  };
}

module.exports = {
  DEFAULT_PIDS_LIMIT,
  DEFAULT_MEMORY_BYTES,
  dockerResourceCliArgs,
  dockerResourceHostConfig,
};
