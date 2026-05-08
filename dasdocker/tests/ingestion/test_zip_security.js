'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const AdmZip = require(require('path').join(__dirname, '../../services/orchestrator/node_modules/adm-zip'));
const {
  validateZipEntryPath,
  isUnixSymlinkZipAttr,
  entryFailsZipBombHeuristic,
  archiveFailsZipBombHeuristic,
  extractZipBuffer,
  MAX_ZIP_UPLOAD_BYTES,
} = require('../../services/orchestrator/src/ingestion/zip-resolver');

test('VT-UNIT-S03-002: rejects classic zip-slip', () => {
  assert.equal(validateZipEntryPath('../../etc/passwd').ok, false);
  assert.equal(validateZipEntryPath('a/../../etc/passwd').ok, false);
});

test('VT-UNIT-S03-002: rejects absolute POSIX path', () => {
  assert.equal(validateZipEntryPath('/etc/shadow').ok, false);
});

test('VT-UNIT-S03-002: rejects Windows absolute path', () => {
  assert.equal(validateZipEntryPath('C:\\Windows\\System32\\config\\SAM').ok, false);
});

test('VT-UNIT-S03-002: rejects .git/config pattern', () => {
  const r = validateZipEntryPath('.git/config');
  assert.equal(r.ok, false);
});

test('VT-UNIT-S03-002: rejects authorized_keys path', () => {
  assert.equal(validateZipEntryPath('../../../root/.ssh/authorized_keys').ok, false);
  const r = validateZipEntryPath('home/user/.ssh/authorized_keys');
  assert.equal(r.ok, false);
});

test('VT-UNIT-S03-002: allows benign project tree', () => {
  const r = validateZipEntryPath('src/app/index.js');
  assert.equal(r.ok, true);
  assert.equal(r.posixPath, 'src/app/index.js');
});

test('VT-UNIT-S03-002: rejects NUL in entry name', () => {
  assert.equal(validateZipEntryPath('a\0b').ok, false);
});

test('isUnixSymlinkZipAttr detects symlink mode in high bits', () => {
  const symlinkAttr = (0o120777 << 16) >>> 0;
  assert.equal(isUnixSymlinkZipAttr(symlinkAttr), true);
  assert.equal(isUnixSymlinkZipAttr(0o100644 << 16), false);
});

test('VT-RED-S03-002: zip bomb entry ratio', () => {
  assert.equal(entryFailsZipBombHeuristic(1024 * 11, 1024), true);
  assert.equal(entryFailsZipBombHeuristic(1024 * 5, 1024), false);
});

test('VT-RED-S03-002: rejects >1GiB uncompressed single entry declaration', () => {
  assert.equal(entryFailsZipBombHeuristic(2 * 1024 * 1024 * 1024, 100), true);
});

test('archive heuristic flags tiny compressed vs declared huge uncomp', () => {
  assert.equal(archiveFailsZipBombHeuristic(100 * 1024 * 1024, 1024), true);
});

test('extractZipBuffer rejects oversize upload buffer', async () => {
  const buf = Buffer.alloc(MAX_ZIP_UPLOAD_BYTES + 1);
  const r = await extractZipBuffer(buf, path.join(os.tmpdir(), 'nope'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ZIP_TOO_LARGE');
});

test('extractZipBuffer accepts minimal stored zip fixture', async () => {
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('hello'), '', 0o100644 << 16);
  const buf = zip.toBuffer();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dz-'));
  const r = await extractZipBuffer(buf, path.join(dir, 'out'));
  assert.equal(r.ok, true);
  const body = await fsp.readFile(path.join(dir, 'out', 'readme.txt'), 'utf8');
  assert.equal(body, 'hello');
});

test('VT-UNIT-S03-002: traversal segments rejected at validation layer (explicit vectors)', () => {
  assert.equal(validateZipEntryPath('foo/../bar').ok, false);
  assert.equal(validateZipEntryPath('src/../../../etc/passwd').ok, false);
});

