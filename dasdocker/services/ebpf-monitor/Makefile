SHELL := /bin/bash
CLANG ?= clang
CC ?= gcc
LIBBPF_CFLAGS ?= -I/usr/include -I/usr/include/bpf
LIBBPF_LDFLAGS ?= -lbpf -lelf -lz -lhiredis
BPF_CFLAGS := -O2 -g -target bpf -D__TARGET_ARCH_x86

SRC_DIR := src
BUILD_DIR := build

BPF_SRCS := \
	$(SRC_DIR)/exec_monitor.bpf.c \
	$(SRC_DIR)/file_monitor.bpf.c \
	$(SRC_DIR)/net_monitor.bpf.c \
	$(SRC_DIR)/privilege_monitor.bpf.c \
	$(SRC_DIR)/suspicious_monitor.bpf.c

BPF_OBJS := $(patsubst $(SRC_DIR)/%.bpf.c,$(BUILD_DIR)/%.bpf.o,$(BPF_SRCS))

.PHONY: all clean collector
all: $(BPF_OBJS) collector

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/%.bpf.o: $(SRC_DIR)/%.bpf.c | $(BUILD_DIR)
	$(CLANG) $(BPF_CFLAGS) $(LIBBPF_CFLAGS) -c $< -o $@

collector: $(BUILD_DIR)/container-scope

$(BUILD_DIR)/container-scope: $(SRC_DIR)/container-scope.c | $(BUILD_DIR)
	$(CC) -O2 -g $(LIBBPF_CFLAGS) $< -o $@ $(LIBBPF_LDFLAGS)

clean:
	rm -rf $(BUILD_DIR)
