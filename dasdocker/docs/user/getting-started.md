# dasDocker Getting Started

## 1) Start a Session

1. Open dasDocker and submit either:
   - A GitHub repository URL in the form `https://github.com/<org-or-user>/<repo>` (optional `.git` suffix), or
   - A `.zip` archive upload (max 256 MB).
2. Choose a session TTL (time-to-live). TTL is the maximum runtime window before forced self-destruct.
3. Click **Start session** and wait for the session to reach `RUNNING`.

## 2) Read the Live Console

- The **Live Console** streams stdout/stderr from the sandboxed process.
- State updates (for example `PROVISIONING -> RUNNING`, `RUNNING -> DESTROYED`) are shown inline.
- If a session terminates, the console prints a termination reason when available.

## 3) Interpret Telemetry Panels

- **Process Tree**: process lineage and newly spawned processes. Flagged nodes indicate correlation with security alerts.
- **Network Timeline**: DNS, HTTP, and outbound connection telemetry for the session.
- **IDS Alerts**: severity-tagged detections (`INFO`, `WARNING`, `HIGH`, `CRITICAL`) with rule IDs and descriptions.

## 4) Understand TTL and Kill

- TTL countdown reflects remaining allowed runtime.
- Expired TTL triggers automatic teardown.
- **Kill Session** performs immediate teardown and data destruction for writable runtime state.

## 5) If Something Looks Suspicious

1. Stop interactive actions.
2. Preserve evidence from console + telemetry panels.
3. Terminate the session.
4. Follow the incident workflow in `docs/user/security-posture.md` and the operations runbook.
