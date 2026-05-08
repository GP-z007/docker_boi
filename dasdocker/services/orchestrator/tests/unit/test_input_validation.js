'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateCreatePayload } = require('../../src/routes/sessions');

test('validateCreatePayload accepts compliant github repo URL', () => {
  validateCreatePayload({
    source_url: 'https://github.com/acme/repo.git',
    ttl_seconds: 120,
    source_type: 'github',
  });
});

test('validateCreatePayload rejects non-GitHub host', () => {
  assert.throws(
    () =>
      validateCreatePayload({
        source_url: 'https://evil.com/acme/repo',
        ttl_seconds: 120,
        source_type: 'github',
      }),
    /INVALID_SOURCE_URL/,
  );
});

test('validateCreatePayload enforces TTL window 60–3600', () => {
  assert.throws(
    () =>
      validateCreatePayload({
        source_url: 'https://github.com/acme/repo',
        ttl_seconds: 59,
        source_type: 'github',
      }),
    /INVALID_TTL/,
  );
  assert.throws(
    () =>
      validateCreatePayload({
        source_url: 'https://github.com/acme/repo',
        ttl_seconds: 3601,
        source_type: 'github',
      }),
    /INVALID_TTL/,
  );
});

test('validateCreatePayload restricts source_type', () => {
  assert.throws(
    () =>
      validateCreatePayload({
        source_url: 'https://github.com/acme/repo',
        ttl_seconds: 300,
        source_type: 'npm',
      }),
    /INVALID_SOURCE_TYPE/,
  );
});
