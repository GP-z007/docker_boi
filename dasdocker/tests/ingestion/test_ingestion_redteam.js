'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fsp = require('fs').promises;
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require(require('path').join(__dirname, '../../services/orchestrator/node_modules/adm-zip'));

const zipResolver = require('../../services/orchestrator/src/ingestion/zip-resolver');
const { validateGithubUrl } = require('../../services/orchestrator/src/ingestion/github-resolver');
const { runIngestion } = require('../../services/orchestrator/src/ingestion/ingestion-service');

test('VT-RED-S03-002: symlink zip rejected when zip CLI present', async () => {
  const which = spawnSync('which', ['zip']);
  if (which.status !== 0) {
    test.skip('zip binary not available');
    return;
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sym-'));
  const target = '/etc/passwd';
  const link = path.join(dir, 'leak');
  try {
    fs.symlinkSync(target, link);
  } catch {
    test.skip('cannot create symlink in tmp (permissions)');
    return;
  }
  const zpath = path.join(dir, 'sym.zip');
  const z = spawnSync('zip', ['--symlinks', '-r', zpath, 'leak'], { cwd: dir, encoding: 'utf8' });
  assert.equal(z.status, 0, z.stderr);
  const buf = await fsp.readFile(zpath);
  const out = path.join(dir, 'extract');
  const r = await zipResolver.extractZipBuffer(buf, out);
  assert.equal(r.ok, false);
  assert.match(r.reason, /ZIP_SYMLINK|ZIP_PATH|ZIP_/);
});

test('VT-RED-S03-004: malformed GitHub URL host variants', () => {
  assert.equal(validateGithubUrl('https://github.com.evil.com/foo/bar').ok, false);
  assert.equal(validateGithubUrl('https://www.github.com/foo/bar').ok, false);
});

test('VT-RED-S03: ClamAV unavailable fails closed on full ingest', async () => {
  function spawnMock() {
    return {
      stdout: { on() {} },
      stderr: { on() {} },
      kill() {},
      on(ev, cb) {
        if (ev === 'error') setImmediate(() => cb(new Error('clamd unreachable')));
      },
    };
  }
  const zip = new AdmZip();
  zip.addFile('x.txt', Buffer.from('hi'), '', 0o100644 << 16);
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'ing-'));
  const states = [];
  const r = await runIngestion({
    sessionId: 's-red-clam-1',
    kind: 'zip',
    zipBuffer: zip.toBuffer(),
    workspaceRoot: workspace,
    preScan: { spawnImpl: spawnMock },
    transition: async (_sid, st) => {
      states.push(st);
    },
    emit: async () => {},
  });
  assert.equal(r.ok, false);
  assert.ok(states.includes('FAILED'));
});

test('VT-RED-S03-002: zip bomb — high compression ratio zeros', async () => {
  const zip = new AdmZip();
  zip.addFile('zeros.dat', Buffer.alloc(256 * 1024, 0), '', 0o100644 << 16);
  const buf = zip.toBuffer();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bz-'));
  const r = await zipResolver.extractZipBuffer(buf, path.join(dir, 'o'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ZIP_BOMB_ENTRY');
});
