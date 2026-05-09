// SPDX-License-Identifier: GPL-2.0
#include <linux/types.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

char LICENSE[] SEC("license") = "GPL";

struct net_evt {
  __u64 ts_ns;
  __u64 cgroup_id;
  __u32 pid;
  __u32 uid;
  __u32 dst_ip;
  __u16 dst_port;
  __u16 proto;
  char comm[16];
  char event_type[16];
};

struct trace_event_raw_sys_enter {
  __u64 unused;
  __u64 id;
  __u64 args[6];
};

struct sockaddr_in_compat {
  __u16 sin_family;
  __u16 sin_port;
  __u32 sin_addr;
  __u8 pad[8];
};

struct {
  __uint(type, BPF_MAP_TYPE_RINGBUF);
  __uint(max_entries, 1 << 24);
} events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_connect")
int handle_connect(struct trace_event_raw_sys_enter *ctx) {
  struct net_evt *evt = bpf_ringbuf_reserve(&events, sizeof(*evt), 0);
  struct sockaddr_in_compat sa = {};
  const void *uservaddr = (const void *)ctx->args[1];
  if (!evt)
    return 0;

  evt->ts_ns = bpf_ktime_get_ns();
  evt->cgroup_id = bpf_get_current_cgroup_id();
  evt->pid = (__u32)(bpf_get_current_pid_tgid() >> 32);
  evt->uid = (__u32)(bpf_get_current_uid_gid() & 0xffffffff);
  evt->proto = 0;
  __builtin_memcpy(evt->event_type, "connect", 8);
  bpf_get_current_comm(&evt->comm, sizeof(evt->comm));

  bpf_probe_read_user(&sa, sizeof(sa), uservaddr);
  evt->dst_ip = sa.sin_addr;
  evt->dst_port = bpf_ntohs(sa.sin_port);

  bpf_ringbuf_submit(evt, 0);
  return 0;
}
