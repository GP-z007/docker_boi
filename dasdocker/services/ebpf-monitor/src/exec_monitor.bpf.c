// SPDX-License-Identifier: GPL-2.0
#include <linux/types.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

struct exec_evt {
  __u64 ts_ns;
  __u64 cgroup_id;
  __u32 pid;
  __u32 ppid;
  __u32 uid;
  char comm[16];
  char args[128];
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

SEC("tracepoint/syscalls/sys_enter_execve")
int handle_execve(struct trace_event_raw_sys_enter *ctx) {
  struct exec_evt *evt = bpf_ringbuf_reserve(&events, sizeof(*evt), 0);
  const char *filename = (const char *)ctx->args[0];
  if (!evt)
    return 0;

  evt->ts_ns = bpf_ktime_get_ns();
  evt->cgroup_id = bpf_get_current_cgroup_id();
  evt->pid = (__u32)(bpf_get_current_pid_tgid() >> 32);
  evt->ppid = 0;
  evt->uid = (__u32)(bpf_get_current_uid_gid() & 0xffffffff);
  __builtin_memcpy(evt->event_type, "exec", 5);
  bpf_get_current_comm(&evt->comm, sizeof(evt->comm));
  bpf_probe_read_user_str(&evt->args, sizeof(evt->args), filename);
  bpf_ringbuf_submit(evt, 0);
  return 0;
}
