'use strict';

const fs = require('fs');
const readline = require('readline');
const Redis = require('ioredis');
const { SessionRegistry } = require('./session-registry');
const { CaptureManager } = require('./capture-manager');
const { toDasdockerEvent } = require('./eve-parser');
const { StreamPublisher } = require('./publisher');

const EVE_PATH = process.env.DASDOCKER_SURICATA_EVE_PATH || '/var/log/suricata/eve.json';
const REDIS_URL = process.env.DASDOCKER_REDIS_URL || 'redis://127.0.0.1:6379';

async function main() {
  const registry = new SessionRegistry();
  const capture = new CaptureManager();
  const pub = new StreamPublisher(REDIS_URL);
  const sub = new Redis(REDIS_URL);

  await sub.subscribe('dasdocker:control:container_started', 'dasdocker:control:session_state');
  sub.on('message', (_chan, msg) => {
    try {
      const j = JSON.parse(msg);
      if (j.event === 'container:started' && j.source_ip && j.session_id) {
        registry.upsert({
          source_ip: j.source_ip,
          session_id: j.session_id,
          container_id: j.container_id || '',
        });
        capture.startSessionCapture({ session_id: j.session_id, source_ip: j.source_ip });
      }
      if (j.type === 'state_change' && j.to === 'DESTROYED' && j.session_id) {
        const n = capture.stopAndDeleteSessionCapture(j.session_id);
        process.stdout.write(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            event: 'pcap_deleted',
            session_id: j.session_id,
            deleted_files: n,
          })}\n`,
        );
        registry.removeBySession(j.session_id);
      }
    } catch {}
  });

  if (!fs.existsSync(EVE_PATH)) {
    process.stderr.write(`[warn] eve.json path missing: ${EVE_PATH}\n`);
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(EVE_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const sid = registry.lookupSession(row.src_ip || '');
    const evt = toDasdockerEvent(row, sid);
    if (!evt) continue;
    await pub.publish(sid, evt);
  }
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`[fatal] network-monitor failed: ${e}\n`);
    process.exit(1);
  });
}

module.exports = { main };
