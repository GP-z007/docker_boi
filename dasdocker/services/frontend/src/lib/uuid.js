/** RFC 4122 UUID v1–v5 pattern — rejects sequential / short opaque ids (ZTA). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidSessionId(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}
