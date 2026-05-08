'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  parseClamDetections,
  scanTreeWithClamAV,
  optionalVirusTotalScan,
} = require('../../services/orchestrator/src/ingestion/pre-scanner');

test('parseClamDetections extracts FOUND signatures', () => {
  const out = '/workspace/a.js: Win.Test FOUND\n/workspace/b.go: Clean\n';
  const d = parseClamDetections(out);
  assert.equal(d.length, 1);
  assert.match(d[0], /FOUND/);
});

test('scanTreeWithClamAV resolves ok on mocked clamdscan 0', async () => {
  function spawnMock() {
    const child = {
      stdout: { on() {} },
      stderr: { on() {} },
      kill() {},
      on(ev, cb) {
        if (ev === 'close') {
          setImmediate(() => cb(0));
        }
      },
    };
    return child;
  }
  const r = await scanTreeWithClamAV('/tmp/__absent_scan__', {
    spawnImpl: spawnMock,
    timeoutMs: 5000,
  });
  assert.equal(r.ok, true);
});

test('scanTreeWithClamAV rejects on exit 1 infected', async () => {
  function spawnMock() {
    return {
      stdout: {
        on(_ev, cb) {
          setImmediate(() => cb(Buffer.from('/x/eicar.com: Eicar-Signature FOUND\n')));
        },
      },
      stderr: { on() {} },
      kill() {},
      on(ev, cb) {
        if (ev === 'close') setImmediate(() => cb(1));
      },
    };
  }
  const r = await scanTreeWithClamAV('/tmp/x', {
    spawnImpl: spawnMock,
    timeoutMs: 5000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MALWARE_DETECTED');
});

test('scanTreeWithClamAV fail-safe when spawn errors', async () => {
  function spawnMock() {
    return {
      stdout: { on() {} },
      stderr: { on() {} },
      kill() {},
      on(ev, cb) {
        if (ev === 'error') setImmediate(() => cb(new Error('ENOENT')));
      },
    };
  }
  const r = await scanTreeWithClamAV('/tmp/x', { spawnImpl: spawnMock, timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'SCANNER_UNAVAILABLE');
});

test('optionalVirusTotalScan skips when key unset', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vt-'));
  await fsp.writeFile(path.join(dir, 'a.txt'), 'x');
  const r = await optionalVirusTotalScan(dir, { env: {} });
  assert.equal(r.ok, true);
});

test('VT-RED-S03: fail-safe on clamdscan non-zero error code', async () => {
  function spawnMock() {
    return {
      stdout: { on() {} },
      stderr: {
        on(_ev, cb) {
          setImmediate(() => cb(Buffer.from('Cannot connect to daemon\n')));
        },
      },
      kill() {},
      on(ev, cb) {
        if (ev === 'close') setImmediate(() => cb(2));
      },
    };
  }
  const r = await scanTreeWithClamAV('/tmp', {
    spawnImpl: spawnMock,
    timeoutMs: 5000,
    logger: console,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'SCANNER_UNAVAILABLE');
});
