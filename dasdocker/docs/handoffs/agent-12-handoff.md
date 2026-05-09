# Agent 12 — Network Monitor Handoff (Phase 3)

**Branch:** `feat/network-monitor`  
**Deliverable:** 3B.2 (host-side pcap + Suricata IDS + Redis event publication).

## Scope implemented

- Host-side capture manager (`services/network-monitor/src/capture-manager.js`)
  - interface: `br-dasd-isolated` (Agent 03 pinned bridge for `dasdocker-isolated`)
  - per-session capture filtered by container source IP
  - tcpdump file rotation every 60s (`-G 60`)
  - pcap path: `/tmp/dasdocker-pcap/{session_id}.pcap-*` (host tmpfs intent)

- Suricata integration config:
  - `config/suricata/suricata.yaml`
  - `config/suricata/custom-rules/dasdocker.rules`
  - includes custom signatures for:
    - `.onion` / `.i2p` DNS
    - pastebin/hastebin HTTP destinations
    - known-bad User-Agent (test trigger)
    - port-scan threshold
    - Tor guard range egress

- EVE parser + Redis publisher:
  - `services/network-monitor/src/eve-parser.js`
  - `services/network-monitor/src/session-registry.js`
  - `services/network-monitor/src/publisher.js`
  - `services/network-monitor/src/index.js`
  - maps `src_ip -> session_id`, converts EVE JSON to:
    - `alert_event` (from Suricata alert)
    - `network_event` (`dns_query`, `http_request`)
  - stream target: `dasdocker:events:{session_id}`

- Cleanup on DESTROYED:
  - control subscription `dasdocker:control:session_state`
  - on `state_change` with `to=DESTROYED`, session pcap files removed and deletion logged.

## Security / ZTA posture

- Capture runs on host only; no capture process inside monitored containers.
- Raw pcap stays host-side under `/tmp/dasdocker-pcap`; never forwarded to frontend.
- Frontend receives only structured `network_event` / `alert_event` via Redis -> event bus.

## Tests added

- `tests/network-monitor/test_dns_capture.sh`
- `tests/network-monitor/test_http_capture.sh`
- `tests/network-monitor/test_suricata_alert.sh`
- `tests/network-monitor/test_pcap_cleanup.sh`

These tests validate DNS capture, HTTP capture, IDS alert path, and pcap cleanup behavior (with environment-aware skips where host deps are unavailable).
