// SPDX-License-Identifier: GPL-2.0
#include <linux/types.h>
#include <bpf/bpf_helpers.h>

char LICENSE[] SEC("license") = "GPL";

struct file_evt {
  __u64 ts_ns;
  __u64 cgroup_id;
  __u32 pid;
  __u32 uid;
  __u32 flags;
  char comm[16];
  char path[128];
  char event_type[16];
};

struct trace_event_raw_sys_enter {
  __u64 unused;
  __u64 id;
  __u64 args[6];
};

struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 1 << 24);
} events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_openat")
int handle_openat(struct trace_event_raw_sys_enter *ctx) {
  struct file_evt *evt = bpf_ringbuf_reserve(&events, sizeof(*evt), 0);
  const char *filename = (const char *)ctx->args[1];
  if (!evt)
    return 0;

  evt->ts_ns = bpf_ktime_get_ns();
  evt->cgroup_id = bpf_get_current_cgroup_id();
  evt->pid = (__u32)(bpf_get_current_pid_tgid() >> 32);
  evt->uid = (__u32)(bpf_get_current_uid_gid() & 0xffffffff);
  evt->flags = (__u32)ctx->args[2];
  __builtin_memcpy(evt->event_type, "open", 5);
  bpf_get_current_comm(&evt->comm, sizeof(evt->comm));
  bpf_probe_read_user_str(&evt->path, sizeof(evt->path), filename);
  bpf_ringbuf_submit(evt, 0);
  return 0;
}
