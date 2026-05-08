# dasDocker sandbox AppArmor profile (Agent 02 — Container Hardening baseline)
# Host install: /etc/apparmor.d/dasdocker-container (root:root 0644)
# Load: sudo apparmor_parser -r -W /etc/apparmor.d/dasdocker-container
# Docker: --security-opt apparmor=dasdocker-container
#
# STRIDE alignment: T-S04-002, T-S04-003, T-S05-004, T-S06-001, T-S08-001
#
# Depends on host packages: apparmor + apparmor-parser; paths #include tunables/abstractions below.

abi <abi/4.0>,

#include <tunables/global>

profile dasdocker-container flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # --- Denied kernel/control interfaces (belt-and-suspenders with seccomp + read-only root) ---
  deny /sys/** wlkmr,
  deny /sys/kernel/** wlkmr,
  deny /proc/sys/** wlkmr,
  deny /proc/sysrq-trigger wlkmr,

  deny /dev/kmem wlkmr,
  deny /dev/mem wlkmr,
  deny /dev/port wlkmr,

  deny /var/run/docker.sock wlkmr,
  deny /run/docker.sock wlkmr,

  # --- Capability mediation (orchestrator uses CAP_DROP ALL; this limits AA-respected caps) ---
  deny capability sys_admin,
  deny capability net_admin,
  deny capability net_raw,
  deny capability sys_module,
  deny capability sys_ptrace,
  deny capability sys_rawio,
  deny capability sys_boot,
  deny capability bpf,
  deny capability perfmon,
  deny capability linux_immutable,
  deny capability mknod,
  deny capability mac_admin,
  deny capability mac_override,

  capability audit_write,
  capability chown,
  capability dac_override,
  capability dac_read_search,
  capability fowner,
  capability fsetid,
  capability kill,
  capability net_bind_service,
  capability setfcap,
  capability setgid,
  capability setpcap,
  capability setuid,
  capability syslog,

  # --- Filesystem islands (writable paths MUST be orchestrator-mounted tmpfs; rootfs read-only via Docker) ---
  /tmp/** rw,
  /var/tmp/** rw,
  /workspace/** rw,
  /dev/shm/** rw,

  deny /sbin/modprobe wlkmr,
  deny /sbin/insmod wlkmr,

  # --- Network (T-S08-001): SOCK_STREAM/SOCK_DGRAM only; deny raw/packet ---
  network inet stream,
  network inet6 stream,
  network inet dgram,
  network inet6 dgram,

  deny network raw,
}
