'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  detectRuntimeSpec,
  walkSourceTree,
  MAX_DETECTION_DEPTH,
} = require('../../services/orchestrator/src/runtime-detection/detector');

/**
 * WHY mkdirp+write helpers: ephemeral synthetic corpora — never trusts fixture content beyond static writes.
 *
 * @param {string} base
 * @param {Record<string, string | null>} files rel -> utf8 contents; `null` = touch empty file
 */
function materializeFixture(base, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const fp = path.join(base, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    if (contents === null) fs.writeFileSync(fp, '');
    else fs.writeFileSync(fp, contents);
  }
}

test('fixture: detects nodejs strong manifest + npm ci lockfile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-node-'));
  materializeFixture(root, {
    'package.json': JSON.stringify({
      private: true,
      dependencies: { lodash: '^4' },
      scripts: { start: 'node ./src/index.js' },
    }),
    'package-lock.json': '{}',
    'src/index.js': "console.log('x');\n",
  });
  const r = detectRuntimeSpec({ sessionId: 's1', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'nodejs');
  assert.ok(r.spec.install_commands.includes('npm ci'));
});

test('fixture: detects python via requirements.txt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-py-'));
  materializeFixture(root, {
    'requirements.txt': 'flask\n',
    'main.py': 'print(1)\n',
  });
  const r = detectRuntimeSpec({ sessionId: 's2', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'python');
  assert.ok(r.spec.install_commands.some((c) => c.startsWith('pip install -r ')));
});

test('fixture: detects go via go.mod + root main.go', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-go-'));
  materializeFixture(root, {
    'go.mod': 'module example.com/x\n',
    'main.go': 'package main\nfunc main(){}\n',
  });
  const r = detectRuntimeSpec({ sessionId: 's3', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'go');
  assert.deepEqual(r.spec.install_commands, ['go mod download']);
});

test('fixture: detects rust via Cargo.toml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-rs-'));
  materializeFixture(root, {
    'Cargo.toml':
      '[package]\nname = "t"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': 'fn main(){}\n',
  });
  const r = detectRuntimeSpec({ sessionId: 's4', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'rust');
  assert.deepEqual(r.spec.install_commands, ['cargo build --release']);
});

test('fixture: detects java maven via pom.xml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-jv-'));
  materializeFixture(root, {
    'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>\n',
  });
  const r = detectRuntimeSpec({ sessionId: 's5', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'java');
  assert.ok(r.spec.install_commands.some((c) => c.startsWith('mvn ')));
});

test('fixture: detects ruby via Gemfile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-rb-'));
  materializeFixture(root, {
    Gemfile: "source 'https://rubygems.org'\ngem 'sinatra'\n",
    'main.rb': 'puts 1',
  });
  const r = detectRuntimeSpec({ sessionId: 's6', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'ruby');
  assert.deepEqual(r.spec.install_commands, ['bundle install']);
});

test('fixture: detects php via composer.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-php-'));
  materializeFixture(root, {
    'composer.json': '{"name":"x/y","require":{}}',
    'public/index.php': '<?php echo 1;',
  });
  const r = detectRuntimeSpec({ sessionId: 's7', sourceRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.spec.runtime, 'php');
  assert.ok(
    r.spec.install_commands.some((c) => c === 'composer install' || c === 'composer install --no-dev'),
  );
});

test('fixture: dotnet-only fails closed — install verbs off mandated allowlist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-dn-'));
  materializeFixture(root, {
    'App/App.csproj':
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>',
  });
  const r = detectRuntimeSpec({ sessionId: 's8', sourceRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.failure_reason, 'UNSAFE_COMMAND_GENERATED');
  assert.equal(r.spec.runtime, 'dotnet');
});

test('walkSourceTree honours MAX_DETECTION_DEPTH (no reads beyond)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-depth-'));
  let cursor = root;
  for (let i = 0; i < 8; i += 1) {
    cursor = path.join(cursor, `d${i}`);
    fs.mkdirSync(cursor);
  }
  fs.writeFileSync(path.join(cursor, 'secret.txt'), 'x');
  const tree = walkSourceTree(root);
  assert.equal(tree.has('d0/d1/d2/d3/d4/d5/d6/d7/secret.txt'), false);
  assert.ok(tree.has('d0/d1/d2/d3/d4')); /* boundary directory might exist */
});

test('yarn.lock without package.json → RUNTIME_UNDETECTABLE node path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-or-'));
  materializeFixture(root, { 'yarn.lock': '', 'README.md': 'x' });
  const r = detectRuntimeSpec({ sessionId: 's9', sourceRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.failure_reason, 'RUNTIME_UNDETECTABLE');
});
