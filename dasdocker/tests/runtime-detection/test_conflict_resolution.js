'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveConflictScores } = require('../../services/orchestrator/src/runtime-detection/detector');

/**
 * WHY synthetic score maps: unit-test deterministic tie ladders without spawning full workspaces.
 */

const EMPTY_MANIFESTS = {
  yarnLockRoot: false,
  packageJson: null,
  dockerfile: false,
};

test('nodejs + python tied within 0.05 → MULTI_RUNTIME', () => {
  const scores = new Map([
    ['nodejs', { runtime: 'nodejs', numericConfidence: 0.75, tier: 2, signals: ['a'] }],
    ['python', { runtime: 'python', numericConfidence: 0.75, tier: 2, signals: ['b'] }],
  ]);
  const r = resolveConflictScores(scores, new Map(), { ...EMPTY_MANIFESTS });
  assert.equal(r.multi_runtime, true);
  assert.ok(['nodejs', 'python'].includes(r.runtime));
  assert.ok(r.alternate_runtimes.length >= 1);
});

test('python + golang tied → MULTI_RUNTIME', () => {
  const scores = new Map([
    ['python', { runtime: 'python', numericConfidence: 0.8, tier: 2, signals: ['p'] }],
    ['go', { runtime: 'go', numericConfidence: 0.8, tier: 2, signals: ['g'] }],
  ]);
  const r = resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS);
  assert.equal(r.multi_runtime, true);
});

test('go + rust tied → MULTI_RUNTIME', () => {
  const scores = new Map([
    ['go', { runtime: 'go', numericConfidence: 0.82, tier: 2, signals: ['g'] }],
    ['rust', { runtime: 'rust', numericConfidence: 0.82, tier: 2, signals: ['r'] }],
  ]);
  assert.equal(resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS).multi_runtime, true);
});

test('nodejs + rust tied → MULTI_RUNTIME', () => {
  const scores = new Map([
    ['nodejs', { runtime: 'nodejs', numericConfidence: 0.85, tier: 2, signals: [] }],
    ['rust', { runtime: 'rust', numericConfidence: 0.85, tier: 2, signals: [] }],
  ]);
  assert.equal(resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS).multi_runtime, true);
});

test('java + ruby separated by score gap → single winner', () => {
  const scores = new Map([
    ['java', { runtime: 'java', numericConfidence: 0.9, tier: 2, signals: [] }],
    ['ruby', { runtime: 'ruby', numericConfidence: 0.6, tier: 2, signals: [] }],
  ]);
  const r = resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS);
  assert.equal(r.multi_runtime, false);
  assert.equal(r.runtime, 'java');
});

test('php + python tied → MULTI_RUNTIME', () => {
  const scores = new Map([
    ['php', { runtime: 'php', numericConfidence: 0.7, tier: 2, signals: [] }],
    ['python', { runtime: 'python', numericConfidence: 0.7, tier: 2, signals: [] }],
  ]);
  assert.equal(resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS).multi_runtime, true);
});

test('javascript + go + rust — first pair within band still resolved', () => {
  const scores = new Map([
    ['nodejs', { runtime: 'nodejs', numericConfidence: 0.77, tier: 2, signals: [] }],
    ['go', { runtime: 'go', numericConfidence: 0.77, tier: 2, signals: [] }],
    ['rust', { runtime: 'rust', numericConfidence: 0.5, tier: 2, signals: [] }],
  ]);
  const r = resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS);
  assert.equal(r.multi_runtime, true);
});

test('pairwise matrix: iterate key runtime combos for MULTI_RUNTIME at equal confidence', () => {
  const ids = ['nodejs', 'python', 'go', 'rust', 'java', 'ruby', 'php'];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const scores = new Map([
        [a, { runtime: a, numericConfidence: 0.76, tier: 2, signals: [`${a}`] }],
        [b, { runtime: b, numericConfidence: 0.76, tier: 2, signals: [`${b}`] }],
      ]);
      const r = resolveConflictScores(scores, new Map(), EMPTY_MANIFESTS);
      assert.equal(
        r.multi_runtime,
        true,
        `${a}+${b} should force MULTI_RUNTIME at identical confidence`,
      );
    }
  }
});
