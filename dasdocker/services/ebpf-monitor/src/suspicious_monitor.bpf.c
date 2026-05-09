// SPDX-License-Identifier: GPL-2.0
#include <linux/types.h>
#include <bpf/bpf_helpers.h>

char LICENSE[] SEC("license") = "GPL";

struct sus_evt {
  __u64 ts_ns;
  __u64 cgroup_id;
  __u32 pid;
  __u32 uid;
  __u64 arg0;
  char comm[16];
  char event_type[16];
  char syscall_name[24];
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

static __always_inline int emit(struct trace_event_raw_sys_enter *ctx, const char *name, __u32 len) {
  struct sus_evt *evt = bpf_ringbuf_reserve(&events, sizeof(*evt), 0);
  if (!evt)
    return 0;
  evt->ts_ns = bpf_ktime_get_ns();
  evt->cgroup_id = bpf_get_current_cgroup_id();
  evt->pid = (__u32)(bpf_get_current_pid_tgid() >> 32);
  evt->uid = (__u32)(bpf_get_current_uid_gid() & 0xffffffff);
  evt->arg0 = ctx->args[0];
  __builtin_memcpy(evt->event_type, "suspicious", 11);
  __builtin_memcpy(evt->syscall_name, name, len);
  bpf_get_current_comm(&evt->comm, sizeof(evt->comm));
  bpf_ringbuf_submit(evt, 0);
  return 0;
}

SEC("tracepoint/syscalls/sys_enter_ptrace")
int handle_ptrace(struct trace_event_raw_sys_enter *ctx) { return emit(ctx, "ptrace", 7); }

SEC("tracepoint/syscalls/sys_enter_mount")
int handle_mount(struct trace_event_raw_sys_enter *ctx) { return emit(ctx, "mount", 6); }

SEC("tracepoint/syscalls/sys_enter_finit_module")
int handle_finit_module(struct trace_event_raw_sys_enter *ctx) { return emit(ctx, "finit_module", 13); }
