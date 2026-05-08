# syntax=docker/dockerfile:1.6
#
# Agent 05 — reproducible orchestrator runtime (Deliverable 2.6).
# [Rule 1] Final stage is distroless → no interactive shell shipped (T-S04-002 containment helper).

FROM node@sha256:c6585df72c34172bebd8d36abed961e231d7d3b5cee2e01294c4495e8a03f687 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs20-debian12@sha256:6848ce991f65e2ee8641b9c75d8d38b25d3bc45014b5dd6b31b736d152c8a0f8 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --chown=nonroot:nonroot src ./src
COPY --chown=nonroot:nonroot package.json ./
USER nonroot:nonroot
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["/app/src/index.js"]
