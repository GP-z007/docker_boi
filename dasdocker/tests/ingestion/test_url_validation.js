'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GITHUB_URL_REGEX,
  validateGithubUrl,
} = require('../../services/orchestrator/src/ingestion/github-resolver');

test('VT-UNIT-S03-001: allows canonical org/repo HTTPS', () => {
  assert.equal(validateGithubUrl('https://github.com/octocat/Hello-World').ok, true);
  assert.equal(validateGithubUrl('https://github.com/octocat/Hello-World.git').ok, true);
});

test('VT-UNIT-S03-001: rejects http scheme', () => {
  const r = validateGithubUrl('http://github.com/a/b');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'GITHUB_URL_NOT_ALLOWLISTED');
});

test('VT-UNIT-S03-001: rejects non-GitHub host', () => {
  assert.equal(validateGithubUrl('https://gitlab.com/foo/bar').ok, false);
  assert.equal(validateGithubUrl('https://evil.com/github.com/foo/bar').ok, false);
});

test('VT-RED-S03-001: rejects URL with username/password', () => {
  assert.equal(validateGithubUrl('https://user:pass@github.com/a/b').ok, false);
});

test('VT-RED-S03-001: rejects IP-literal host', () => {
  assert.equal(validateGithubUrl('https://127.0.0.1/foo/bar').ok, false);
  assert.equal(validateGithubUrl('https://192.168.1.10/foo/bar').ok, false);
});

test('VT-RED-S03-001: rejects localhost spoof', () => {
  assert.equal(validateGithubUrl('https://localhost/foo/bar').ok, false);
  assert.equal(validateGithubUrl('https://localhost:8089/foo/bar').ok, false);
});

test('VT-UNIT-S03-001: rejects path traversal or extra segments', () => {
  assert.equal(validateGithubUrl('https://github.com/foo/bar/../baz').ok, false);
  assert.equal(validateGithubUrl('https://github.com/foo/bar/releases').ok, false);
  assert.equal(validateGithubUrl('https://github.com/foo/bar/tree/main').ok, false);
});

test('VT-UNIT-S03-001: rejects query and fragment SSRF aides', () => {
  assert.equal(validateGithubUrl('https://github.com/foo/bar?tab=readme').ok, false);
  assert.equal(validateGithubUrl('https://github.com/foo/bar#main').ok, false);
});

test('VT-UNIT-S03-001: rejects missing org/repo', () => {
  assert.equal(validateGithubUrl('https://github.com/').ok, false);
  assert.equal(validateGithubUrl('https://github.com/single').ok, false);
});

test('VT-UNIT-S03-002: rejects empty and non-string URLs', () => {
  assert.equal(validateGithubUrl('').ok, false);
  assert.equal(validateGithubUrl(null).reason, 'URL_NOT_STRING');
});

test('VT-UNIT-S03-003: trims benign whitespace around allowlisted URL', () => {
  const r = validateGithubUrl('  https://github.com/o/r  ');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://github.com/o/r');
});

test('GITHUB_URL_REGEX rejects Unicode homoglyphs in org segment', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.com/org\u200b/repo/repo'), false);
});

test('regex rejects empty segment via double slash', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.com/org//repo'), false);
});

test('regex allows dots and dashes inside segments', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.com/org.name/repo-name'), true);
});

test('regex rejects SSH-style scp pseudo-URL', () => {
  assert.equal(GITHUB_URL_REGEX.test('git@github.com:foo/bar.git'), false);
});

test('regex rejects github.io', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.io/foo/bar'), false);
});

test('regex rejects raw.githubusercontent.com', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://raw.githubusercontent.com/foo/bar/main/x'), false);
});

test('regex rejects trailing slash', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.com/foo/bar/'), false);
});

test('regex rejects port suffix', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://github.com:443/foo/bar'), false);
});

test('regex rejects uppercase host (strict https://github.com only)', () => {
  assert.equal(GITHUB_URL_REGEX.test('https://GitHub.com/foo/bar'), false);
});

test('VT-RED-S03-001: rejects percent-encoded host tricks (if input stays encoded)', () => {
  assert.equal(validateGithubUrl('https://github.com%2ecom.evil/foo/bar').ok, false);
});
