'use strict';

const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g;
const ENV_ASSIGN = /\b([A-Z][A-Z0-9_]{2,})=([^\s]+)/g;

/**
 * Only metadata is allowed in logs; redact secrets/token/env values.
 * @param {string} text
 */
function redactLogLine(text) {
  const src = String(text || '');
  return src
    .replace(AWS_KEY, '[REDACTED_AWS_KEY]')
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(ENV_ASSIGN, (_m, k) => `${k}=[REDACTED]`);
}

module.exports = { redactLogLine };
