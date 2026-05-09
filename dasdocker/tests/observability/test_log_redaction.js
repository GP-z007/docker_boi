'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactLogLine } = require('../../services/alerting/src/redaction');

test('Sensitive values are redacted before Loki output', () => {
  const src =
    'AWS_SECRET_ACCESS_KEY=AKIA1234567890ABCDEF token=eyJhbGciOiJSUzI1NiJ9.abc.sig DB_PASSWORD=supersecret';
  const redacted = redactLogLine(src);
  assert.equal(redacted.includes('AKIA1234567890ABCDEF'), false);
  assert.equal(redacted.includes('supersecret'), false);
  assert.equal(redacted.includes('eyJhbGciOiJSUzI1NiJ9'), false);
  assert.equal(redacted.includes('AWS_SECRET_ACCESS_KEY=[REDACTED]'), true);
  assert.equal(redacted.includes('DB_PASSWORD=[REDACTED]'), true);
});
