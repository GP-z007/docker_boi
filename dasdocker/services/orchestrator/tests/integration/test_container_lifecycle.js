'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('integration: hardened docker create prerequisites', (t) => {
  if (process.env.DOCKER_E2E !== '1') {
    t.skip('set DOCKER_E2E=1 on hardened CI runners exercising seccomp/AppArmor overlays');
    return;
  }

  const r = spawnSync('docker', ['info'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const net = spawnSync('docker', ['network', 'inspect', 'dasdocker-isolated'], { encoding: 'utf8' });
  assert.equal(net.status, 0, 'expected dasdocker-isolated bridge for sandbox cohort');
});
