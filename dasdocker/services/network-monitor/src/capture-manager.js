'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_IFACE = process.env.DASDOCKER_CAPTURE_IFACE || 'br-dasd-isolated';
const PCAP_ROOT = process.env.DASDOCKER_PCAP_ROOT || '/tmp/dasdocker-pcap';

class CaptureManager {
  constructor() {
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.procs = new Map();
    fs.mkdirSync(PCAP_ROOT, { recursive: true });
  }

  /**
   * @param {{session_id:string,source_ip:string}} args
   */
  startSessionCapture(args) {
    if (!args?.session_id || !args?.source_ip) return;
    if (this.procs.has(args.session_id)) return;
    const outBase = path.join(PCAP_ROOT, `${args.session_id}.pcap`);
    const filter = `src host ${args.source_ip} or dst host ${args.source_ip}`;
    const child = spawn(
      'tcpdump',
      ['-i', DEFAULT_IFACE, '-U', '-n', filter, '-G', '60', '-w', `${outBase}-%Y%m%d%H%M%S`],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    child.stderr.on('data', () => {});
    child.on('close', () => this.procs.delete(args.session_id));
    this.procs.set(args.session_id, child);
  }

  /**
   * @param {string} sessionId
   */
  stopAndDeleteSessionCapture(sessionId) {
    const proc = this.procs.get(sessionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.procs.delete(sessionId);
    }
    const files = fs.readdirSync(PCAP_ROOT).filter((f) => f.startsWith(`${sessionId}.pcap-`));
    for (const f of files) fs.rmSync(path.join(PCAP_ROOT, f), { force: true });
    return files.length;
  }
}

module.exports = { CaptureManager, PCAP_ROOT, DEFAULT_IFACE };
