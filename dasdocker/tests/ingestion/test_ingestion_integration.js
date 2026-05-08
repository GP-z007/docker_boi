'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const AdmZip = require(require('path').join(__dirname, '../../services/orchestrator/node_modules/adm-zip'));
const { runIngestion } = require('../../services/orchestrator/src/ingestion/ingestion-service');
const githubResolver = require('../../services/orchestrator/src/ingestion/github-resolver');

test('INT-S03-zip: full zip ingest with pre-scan skipped (deterministic)', async () => {
  const zip = new AdmZip();
  zip.addFile('package.json', Buffer.from('{"name":"t","version":"1.0.0"}'), '', 0o100644 << 16);
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'ing-'));
  const states = [];
  const r = await runIngestion({
    sessionId: 's-int-zip-1',
    kind: 'zip',
    zipBuffer: zip.toBuffer(),
    workspaceRoot: workspace,
    preScan: { skip: true },
    transition: async (sid, st) => {
      states.push({ sid, st });
    },
    emit: async () => {},
  });
  assert.equal(r.ok, true);
  assert.ok(r.sourceTreePath);
  await fsp.access(path.join(r.sourceTreePath, 'package.json'));
  assert.ok(states.some((x) => x.st === 'PROVISIONING'));
});

test(
  'INT-S03-git: shallow clone hello-world',
  { skip: !process.env.DASDOCKER_INGEST_NET_TEST },
  async () => {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'ing-'));
    const states = [];
    const url = 'https://github.com/octocat/Hello-World.git';
    const v = githubResolver.validateGithubUrl(url);
    assert.equal(v.ok, true);

    const r = await runIngestion({
      sessionId: 's-int-git-1',
      kind: 'github',
      githubUrl: url,
      workspaceRoot: workspace,
      preScan: { skip: true },
      transition: async (sid, st) => {
        states.push(st);
      },
      emit: async () => {},
    });

    assert.equal(r.ok, true);
    const root = r.sourceTreePath;
    const hasReadme =
      fs.existsSync(path.join(root, 'README')) || fs.existsSync(path.join(root, 'README.md'));
    assert.equal(hasReadme, true);
    assert.equal(states.includes('FAILED'), false);
  },
);
