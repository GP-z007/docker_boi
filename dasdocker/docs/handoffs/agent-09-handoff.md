# Agent 09 Handoff — RAM Disk & Ephemeral Storage (tmpfs)

## Rule 4 — Exact Docker flags Agent 08 MUST merge for every sandbox

Use **only** these **`HostConfig.Tmpfs`** / CLI equivalents — **no writable bind mounts**, **no anonymous host paths** (T-S04-001 / T-S06-001).

```bash
--tmpfs /workspace:rw,size=512m,noexec,nosuid,nodev,uid=1000,gid=1000 \
--tmpfs /tmp:rw,size=64m,noexec,nosuid,nodev
```

| Option | Meaning |
|--------|---------|
| **`rw`** | Writable layer for untrusted workload (**only** on these tmpfs paths — rootfs remains **`--read-only`** per baseline). |
| **`size=`** | Kernel-enforced RAM quota; breached writes return **ENOSPC** (VT-INT-S04-004). |
| **`noexec`** | Blocks executing binaries dropped into scratch (T-S04-002). |
| **`nosuid`** | Ignores setuid bits on rogue files (privilege strip). |
| **`nodev`** | Prevents special device nodes inside tmpfs (gadget / kernel abuse class). |
| **`uid=` / `gid=`** *(workspace)* | Owns nodes as the non-root workload identity (align **`--user`** with orchestrator policy — default **1000:1000** here; baseline **65534** deployments must set matching **`uid`/`gid`** in tmpfs opts). |

**Recommended container naming / labels** (from **`provisionStorage()`**):

- Name: **`dasdocker-sess-<sessionId>`**
- Labels: **`dasdocker.session_id=<sessionId>`**, **`dasdocker.storage=tmpfs-only`**

---

## Why tmpfs (Technical Constraint A)

| Approach | Why **not** for sandbox scratch |
|----------|----------------------------------|
| **Bind mount** | Writable host path ⇒ violates ZTA “no host writes”; forensic residue & lateral movement (T-S06-001). |
| **Named volume** | Persistent graph under **`/var/lib/docker/volumes`** until explicit prune — “destroyed with session” is **not** kernel-guaranteed without extra GC. |
| **tmpfs** | RAM-backed; released when the container’s mount namespace ends; no separate delete step; no stable host path for malware to re-open. |

*Caveat:* host **swap** can theoretically page tmpfs under memory pressure — operators should cap / disable swap on sandbox nodes for strictest “RAM only” semantics (ops runbook).

---

## Code module

| File | Exports |
|------|---------|
| **`services/orchestrator/src/storage-controller.js`** | **`provisionStorage(sessionId, options)`** → `{ containerName, labels, hostConfigTmpfs, dockerCliArgs }`; **`verifyStorageDestroyed(sessionId, ctx)`** → `{ ok, detail }` ( **`docker inspect` fails**, **`docker volume ls`** filter empty **, JSON audit line)**; **`getStorageMetrics(containerId)`** → parses **`df`** via **`docker exec`**; **`emitAudit(...)`** JSONL default sink. |

**HostConfig mapping (Docker Engine API):** set **`HostConfig.Tmpfs`** to the returned **`hostConfigTmpfs`** object; append **`HostConfig.Labels`** from **`labels`**.

---

## Tests (`tests/storage/`)

| Script | Intent |
|--------|--------|
| **`test_tmpfs_mount.sh`** | **`findmnt`** asserts **tmpfs**, **512m/64m**, **noexec/nosuid/nodev**, **uid/gid** on **`/workspace`**. |
| **`test_quota_enforcement.sh`** | **`dd`** **~600 MiB** → **ENOSPC** on **`/workspace`**. |
| **`test_data_destruction.sh`** | Post-**`docker rm`**: **`docker inspect` fails**, no session-labelled volumes; **root**: **`grep`** sweep under **`/var/lib/docker`** for random marker token (absent ⇒ pass). |

---

## Git staging (Rule 3)

```bash
cd dasdocker

git checkout -b feat/ram-disk-storage

git add services/orchestrator/src/storage-controller.js
git add tests/storage/test_tmpfs_mount.sh
git add tests/storage/test_quota_enforcement.sh
git add tests/storage/test_data_destruction.sh
git add docs/handoffs/agent-09-handoff.md

git commit -m "feat(storage): implement tmpfs RAM disk provisioning and teardown verification

- Implement storage-controller module with provision/verify/metrics functions
- Specify /workspace (512MB) and /tmp (64MB) tmpfs mounts with noexec,nosuid,nodev
- Add teardown verification confirming zero data persistence post-destruction
- Add 3 tests: mount options, 512MB quota enforcement (ENOSPC), data destruction red-team

Refs: Phase-2 Deliverable 2.3"

git push -u origin feat/ram-disk-storage
```

---

*Agent 09 — RAM Disk & Storage Controller · Phase 2 Deliverable 2.3 · Rules 1–4*
