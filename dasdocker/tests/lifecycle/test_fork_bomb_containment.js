'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { dockerAvailable } = require('./lifecycle_helpers');

const SKIP = process.env.DASDOCKER_LIFECYCLE_INTEGRATION !== '1' || !dockerAvailable();

test(
  'VT-RED-S04: PID cgroup stops fork storm inside sandbox',
  { skip: SKIP },
  () => {
    const r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--init',
        '--pids-limit',
        '40',
        '--security-opt',
        'no-new-privileges:true',
        '--cap-drop',
        'ALL',
        'alpine:3.19',
        'sh',
        '-c',
        'i=0; while [ $i -lt 200 ]; do sleep 999 & i=$((i+1)); done; wait',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 25_000,
      },
    );

    const out = `${r.stdout}${r.stderr}`;
    const ok =
      r.status !== 0 &&
      (/Resource temporarily unavailable|EAGAIN|Can't fork|no child processes|signal: killed/i.test(out) ||
        r.status === 137);
    assert.ok(ok, `expected fork containment, status=${r.status} out=${out.slice(0, 400)}`);
  },
);
