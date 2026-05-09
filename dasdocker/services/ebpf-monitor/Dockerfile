FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  clang llvm make gcc libc6-dev libbpf-dev libelf-dev zlib1g-dev libhiredis-dev libcap2-bin ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/ebpf-monitor
COPY . .
RUN make all

# ZTA runtime identity: non-root userspace collector.
RUN useradd -r -u 22222 -m -d /home/dasdocker-ebpf -s /usr/sbin/nologin dasdocker-ebpf \
  && setcap cap_bpf,cap_perfmon+ep /opt/ebpf-monitor/build/container-scope || true

USER dasdocker-ebpf
ENV DASDOCKER_REDIS_URL=127.0.0.1

ENTRYPOINT ["/opt/ebpf-monitor/build/container-scope"]
