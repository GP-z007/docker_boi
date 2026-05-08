'use strict';

const { spawnSync } = require('child_process');

function dockerAvailable() {
  const r = spawnSync('docker', ['info'], { stdio: ['ignore', 'ignore', 'ignore'] });
  return r.status === 0;
}

module.exports = { dockerAvailable };
