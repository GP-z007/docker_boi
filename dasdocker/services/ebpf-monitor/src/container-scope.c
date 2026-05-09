// SPDX-License-Identifier: MIT
#include <hiredis/hiredis.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_SCOPE_ENTRIES 8192
#define MAX_SESSION_ID 128
#define MAX_JSON 1024
#define MAX_RATE_BUCKETS 2048

struct scope_entry {
  uint64_t cgroup_id;
  char session_id[MAX_SESSION_ID];
  int used;
};

struct rate_bucket {
  char session_id[MAX_SESSION_ID];
  time_t second;
  uint32_t count;
  int used;
};

static struct scope_entry g_scope[MAX_SCOPE_ENTRIES];
static struct rate_bucket g_rate[MAX_RATE_BUCKETS];
static volatile int g_stop = 0;

struct ebpf_msg {
  uint64_t ts_ns;
  uint64_t cgroup_id;
  uint32_t pid;
  uint32_t ppid;
  uint32_t uid;
  uint32_t flags;
  uint32_t dst_ip;
  uint16_t dst_port;
  char type[24];
  char comm[16];
  char text[128];
};

static void on_sigint(int signo) {
  (void)signo;
  g_stop = 1;
}

static int scope_put(uint64_t cgroup_id, const char *session_id) {
  for (int i = 0; i < MAX_SCOPE_ENTRIES; i++) {
    if (g_scope[i].used && g_scope[i].cgroup_id == cgroup_id) {
      snprintf(g_scope[i].session_id, sizeof(g_scope[i].session_id), "%s", session_id);
      return 0;
    }
  }
  for (int i = 0; i < MAX_SCOPE_ENTRIES; i++) {
    if (!g_scope[i].used) {
      g_scope[i].used = 1;
      g_scope[i].cgroup_id = cgroup_id;
      snprintf(g_scope[i].session_id, sizeof(g_scope[i].session_id), "%s", session_id);
      return 0;
    }
  }
  return -1;
}

static const char *scope_lookup(uint64_t cgroup_id) {
  for (int i = 0; i < MAX_SCOPE_ENTRIES; i++) {
    if (g_scope[i].used && g_scope[i].cgroup_id == cgroup_id) return g_scope[i].session_id;
  }
  return NULL;
}

static int allow_event_for_session(const char *session_id) {
  time_t now = time(NULL);
  for (int i = 0; i < MAX_RATE_BUCKETS; i++) {
    if (!g_rate[i].used) continue;
    if (strcmp(g_rate[i].session_id, session_id) != 0) continue;
    if (g_rate[i].second != now) {
      g_rate[i].second = now;
      g_rate[i].count = 1;
      return 1;
    }
    g_rate[i].count++;
    if (g_rate[i].count > 1000) return 0;
    return 1;
  }

  for (int i = 0; i < MAX_RATE_BUCKETS; i++) {
    if (!g_rate[i].used) {
      g_rate[i].used = 1;
      g_rate[i].second = now;
      g_rate[i].count = 1;
      snprintf(g_rate[i].session_id, sizeof(g_rate[i].session_id), "%s", session_id);
      return 1;
    }
  }
  return 0;
}

static int publish_json(redisContext *redis, const char *session_id, const char *json_payload) {
  char stream[256];
  snprintf(stream, sizeof(stream), "dasdocker:events:%s", session_id);
  redisReply *reply = redisCommand(redis, "XADD %s * payload %s", stream, json_payload);
  if (!reply) return -1;
  freeReplyObject(reply);
  return 0;
}

static int publish_rate_limit_alert(redisContext *redis, const char *session_id) {
  char payload[MAX_JSON];
  snprintf(payload, sizeof(payload),
           "{\"type\":\"alert_event\",\"session_id\":\"%s\",\"timestamp\":%ld,"
           "\"severity\":\"warn\",\"rule_id\":\"ALERT-RATE-LIMIT\","
           "\"description\":\"Per-session eBPF event rate exceeded 1000/s\","
           "\"evidence\":{\"source\":\"ebpf-monitor\"}}",
           session_id, time(NULL));
  return publish_json(redis, session_id, payload);
}

static int publish_event(redisContext *redis, const char *session_id, const struct ebpf_msg *m) {
  char payload[MAX_JSON];
  snprintf(payload, sizeof(payload),
           "{\"type\":\"%s\",\"session_id\":\"%s\",\"timestamp\":%llu,"
           "\"event_type\":\"%s\",\"pid\":%u,\"ppid\":%u,\"uid\":%u,"
           "\"comm\":\"%s\",\"args\":\"%s\",\"flags\":%u,\"dst_ip\":\"%u\","
           "\"dst_port\":%u,\"schema_version\":\"1.0\",\"cgroup_key\":\"%llu\"}",
           m->type, session_id, (unsigned long long)m->ts_ns, m->type, m->pid, m->ppid, m->uid, m->comm, m->text,
           m->flags, m->dst_ip, m->dst_port, (unsigned long long)m->cgroup_id);
  return publish_json(redis, session_id, payload);
}

/*
 * NOTE: Orchestrator should publish control messages:
 * {"event":"container:started","container_id":"...","cgroup_id":"123","session_id":"..."}
 * We subscribe and maintain in-memory cgroup -> session map.
 */
static void subscribe_container_started(redisContext *redis_sub) {
  redisReply *r = redisCommand(redis_sub, "SUBSCRIBE dasdocker:control:container_started");
  if (r) freeReplyObject(r);
}

static void poll_control(redisContext *redis_sub) {
  redisReply *reply = NULL;
  if (redisGetReply(redis_sub, (void **)&reply) != REDIS_OK || !reply) return;
  if (reply->type == REDIS_REPLY_ARRAY && reply->elements >= 3 && reply->element[2] &&
      reply->element[2]->str != NULL) {
    const char *msg = reply->element[2]->str;
    const char *sid = strstr(msg, "\"session_id\":\"");
    const char *cid = strstr(msg, "\"cgroup_id\":\"");
    if (sid && cid) {
      char sid_buf[MAX_SESSION_ID] = {0};
      char cg_buf[32] = {0};
      sscanf(sid, "\"session_id\":\"%127[^\"]", sid_buf);
      sscanf(cid, "\"cgroup_id\":\"%31[^\"]", cg_buf);
      scope_put((uint64_t)strtoull(cg_buf, NULL, 10), sid_buf);
    }
  }
  freeReplyObject(reply);
}

int main(void) {
  const char *redis_url = getenv("DASDOCKER_REDIS_URL");
  if (!redis_url) redis_url = "127.0.0.1";

  signal(SIGINT, on_sigint);
  signal(SIGTERM, on_sigint);

  redisContext *redis = redisConnect(redis_url, 6379);
  redisContext *redis_sub = redisConnect(redis_url, 6379);
  if (!redis || redis->err || !redis_sub || redis_sub->err) {
    fprintf(stderr, "failed to connect Redis for event publisher/scoping\n");
    return 1;
  }

  subscribe_container_started(redis_sub);

  /*
   * Integration note:
   * - eBPF program loaders should feed ringbuffer events into `struct ebpf_msg`.
   * - For each message:
   *   1) session = scope_lookup(msg.cgroup_id); if missing -> drop (production policy).
   *   2) apply allow_event_for_session(session) limiter (1000/s).
   *   3) publish event to dasdocker:events:{session_id}.
   */
  while (!g_stop) {
    poll_control(redis_sub);
    usleep(50 * 1000);
  }

  redisFree(redis_sub);
  redisFree(redis);
  return 0;
}
