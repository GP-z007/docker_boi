'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { dockerAvailable } = require('./lifecycle_helpers');

const {
  SessionEventBus,
  provisionContainer,
  installDependenciesSequential,
  markRunningWithEntryPolling,
} = require('../../services/orchestrator/src/container-manager');

const SKIP = process.env.DASDOCKER_LIFECYCLE_INTEGRATION !== '1' || !dockerAvailable();

test(
  'INT-LIFE-001: provision → empty install → short-lived entry → DESTROYED',
  { skip: SKIP },
  async () => {
    const sessionId = `dlife-${Date.now()}`;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlife-'));
    const src = path.join(root, sessionId, 'source');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, 'package.json'),
      JSON.stringify({ private: true, dependencies: {} }),
    );
    fs.writeFileSync(path.join(src, 'index.js'), "console.log('ok');\n");

    const bus = new SessionEventBus();
    const events = [];
    bus.on('state_change', (e) => events.push(e));

    const states = [];
    const transition = async (sid, st) => {
      states.push(st);
    };

    const spec = {
      session_id: sessionId,
      runtime: 'nodejs',
      confidence: 'high',
      install_commands: [],
      entry_point_command: 'node ./index.js',
      env_vars: {},
      detection_signals: [],
      warnings: [],
    };

    process.env.DASDOCKER_INTEGRATION_SKIP_BASELINE = process.env.DASDOCKER_INTEGRATION_SKIP_BASELINE || '1';
    process.env.DASDOCKER_INTEGRATION_SKIP_NETWORK = process.env.DASDOCKER_INTEGRATION_SKIP_NETWORK || '1';

    const ctx = {
      sessionId,
      runtimeSpec: spec,
      sourceHostPath: src,
      transition,
      stateBus: bus,
      logSink: () => {},
      unregister() {},
    };

    const prov = await provisionContainer(ctx);
    const did = await installDependenciesSequential(prov, ctx);
    await markRunningWithEntryPolling(prov, ctx, did, 2000);

    assert.ok(states.includes('DESTROYED'));
    assert.ok(events.some((e) => e.to === 'DESTROYED'));
    assert.ok(events.some((e) => e.type === 'state_change'));
  },
);
