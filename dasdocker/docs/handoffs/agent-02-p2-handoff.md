# Agent 02 Phase 2 Handoff — Seccomp & AppArmor Production Profiles

## (a) What was built

- **Seccomp** (`config/security/seccomp-dasdocker.json`) is deployed to **`/etc/dasdocker/security/seccomp-dasdocker.json`** with **`defaultAction: SCMP_ACT_ERRNO`**, **`defaultErrnoRet: 1`**, Moby-style allowlist (including **CAP-gated** bundles for `ptrace` / `unshare` consistent with **CAP_DROP ALL** orchestration). **No unconditional** `ptrace` allow (**SEC-BASELINE-CNT-001 §3.1**).
- **AppArmor** (`config/security/apparmor-dasdocker.profile`) installs as **`/etc/apparmor.d/dasdocker-container`** with profile name **`dasdocker-container`** (Phase 2 operational name; baseline doc still shows historical `dasdocker` flag — use **`dasdocker-container`** everywhere at runtime).
- **`scripts/deploy-security-profiles.sh`**: root-only, idempotent — creates **`/etc/dasdocker/security`** (**0755** `root:root`), installs blobs **0644** `root:root`, runs **`apparmor_parser -r -W`**, optional **systemd unit** enable when **`DASDOCKER_ROOT=/opt/dasdocker`** (or **`DASDOCKER_FORCE_SYSTEMD_UNIT=1`**).
- **`systemd/dasdocker-security-profiles.service`**: **`Before=docker.service`**, **`WantedBy=multi-user.target`**, boot-time profile sync.
- **Tests (`tests/security/`)**: seccomp positive/negative, AppArmor **`/proc/sysrq-trigger`** denial, **`dasdocker-svc`** filesystem tamper probe.

---

## (b) Agent 08 contract — paths & `docker run` security flags

| Artifact | Canonical host path |
|----------|----------------------|
| Seccomp JSON | `/etc/dasdocker/security/seccomp-dasdocker.json` |
| AppArmor policy file | `/etc/apparmor.d/dasdocker-container` |
| Loader | `sudo /opt/dasdocker/scripts/deploy-security-profiles.sh` (after syncing repo to **`/opt/dasdocker`**) |

**Mandatory security options (add to SEC-BASELINE §6 flags):**

```bash
--security-opt seccomp=/etc/dasdocker/security/seccomp-dasdocker.json \
--security-opt apparmor=dasdocker-container \
--security-opt no-new-privileges:true \
--cap-drop ALL \
```

**Bootstrap layout (ZTA):** sync `dasdocker/` tree to **`/opt/dasdocker`** so **systemd** `ExecStart` and **`DASDOCKER_ROOT`** resolve; then run deploy once (or rely on boot unit).

**Environment variables (optional ops overrides):**

| Variable | Purpose |
|----------|---------|
| `DASDOCKER_ROOT` | Root of installed tree (default: parent of `scripts/`). |
| `DASDOCKER_SECCOMP_PATH` | Test override for `test_seccomp_profile.sh`. |
| `DASDOCKER_INSTALL_SYSTEMD_UNIT` | Set `0` to skip unit install (dev). |
| `DASDOCKER_FORCE_SYSTEMD_UNIT` | Set `1` to install unit even if `DASDOCKER_ROOT` ≠ `/opt/dasdocker`. |

---

## (c) Warnings, limitations, Squad A review

| Item | Notes |
|------|--------|
| **Baseline doc vs runtime name** | `container-baseline-profile.md` still references `--security-opt apparmor=dasdocker` and path `dasdocker`; production uses **`dasdocker-container`**. Reconcile doc in a follow-up **docs** commit if stakeholders require single string. |
| **AppArmor capability allow list** | Phase 1 profile retains explicit `capability` grants that mirror Docker’s effective cap semantics under **`--cap-drop ALL`**; any **cap-add** requires Squad A per baseline §2. |
| **CI runners** | Full tests need **Docker + AppArmor enabled + `dasdocker-svc`** for the red-team file; GitHub-hosted runners often partial — run **`tests/security/*.sh`** on staging metal/VM. |
| **`unshare` negative test** | Uses **`apk add util-linux`** inside Alpine to ensure **`unshare(1)`** exists; syscall remains blocked by default-deny + no **CAP_SYS_ADMIN** path. |

---

*Agent 02 — Container Hardening Specialist · Phase 2 Deliverable 2.1 (profiles) · Rules 1–4*
