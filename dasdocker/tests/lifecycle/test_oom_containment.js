'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { dockerAvailable } = require('./lifecycle_helpers');

const SKIP = process.env.DASDOCKER_LIFECYCLE_INTEGRATION !== '1' || !dockerAvailable();

test(
  'VT-INT-S04: memory cgroup kills runaway allocator (~512Mi)',
  { skip: SKIP },
  () => {
    const r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--memory',
        '512m',
        '--memory-swap',
        '512m',
        'node:20-alpine',
        'node',
        '-e',
        "const a=[]; for(let i=0;i<900;i++) a.push(Buffer.alloc(1024*1024)); console.log('unexpected');",
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      },
    );

    const killed = r.status === 137 || /Killed|OOM|out of memory/i.test(`${r.stderr}${r.stdout}`);
    assert.ok(killed, `expected OOM kill, status=${r.status} err=${r.stderr?.slice(0, 200)}`);
  },
);
